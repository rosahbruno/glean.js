import { GLEAN_VERSION, PING_INFO_STORAGE, CLIENT_INFO_STORAGE } from "../../constants.js";
import { CounterMetric } from "../../metrics/types/counter.js";
import { InternalCounterMetricType as CounterMetricType } from "../../metrics/types/counter.js";
import { DatetimeMetric } from "../../metrics/types/datetime.js";
import { InternalDatetimeMetricType as DatetimeMetricType } from "../../metrics/types/datetime.js";
import TimeUnit from "../../metrics/time_unit.js";
import CoreEvents from "../../events/async.js";
import { Context } from "../../context.js";
import log, { LoggingLevel } from "../../log.js";
import { getPingHeaders, makePath, PINGS_MAKER_LOG_TAG } from "./shared.js";
async function getStartTimeMetricAndData(ping) {
    const startTimeMetric = new DatetimeMetricType({
        category: "",
        name: `${ping.name}#start`,
        sendInPings: [PING_INFO_STORAGE],
        lifetime: "user",
        disabled: false
    }, TimeUnit.Minute);
    const startTimeData = await Context.metricsDatabase.getMetric(PING_INFO_STORAGE, startTimeMetric);
    let startTime;
    if (startTimeData) {
        startTime = new DatetimeMetric(startTimeData);
    }
    else {
        startTime = DatetimeMetric.fromDate(Context.startTime, TimeUnit.Minute);
    }
    return {
        startTimeMetric,
        startTime
    };
}
export async function getSequenceNumber(ping) {
    const seq = new CounterMetricType({
        category: "",
        name: `${ping.name}#sequence`,
        sendInPings: [PING_INFO_STORAGE],
        lifetime: "user",
        disabled: false
    });
    const currentSeqData = await Context.metricsDatabase.getMetric(PING_INFO_STORAGE, seq);
    await seq.addUndispatched(1);
    if (currentSeqData) {
        try {
            const metric = new CounterMetric(currentSeqData);
            return metric.payload();
        }
        catch (e) {
            log(PINGS_MAKER_LOG_TAG, `Unexpected value found for sequence number in ping ${ping.name}. Ignoring.`, LoggingLevel.Warn);
        }
    }
    return 0;
}
export async function getStartEndTimes(ping) {
    const { startTimeMetric, startTime } = await getStartTimeMetricAndData(ping);
    const endTimeData = new Date();
    await startTimeMetric.setUndispatched(endTimeData);
    const endTime = DatetimeMetric.fromDate(endTimeData, TimeUnit.Minute);
    return {
        startTime: startTime.payload(),
        endTime: endTime.payload()
    };
}
export async function buildPingInfoSection(ping, reason) {
    const seq = await getSequenceNumber(ping);
    const { startTime, endTime } = await getStartEndTimes(ping);
    const pingInfo = {
        seq,
        start_time: startTime,
        end_time: endTime
    };
    if (reason) {
        pingInfo.reason = reason;
    }
    return pingInfo;
}
export async function buildClientInfoSection(ping) {
    let clientInfo = await Context.metricsDatabase.getPingMetrics(CLIENT_INFO_STORAGE, true);
    if (!clientInfo) {
        log(PINGS_MAKER_LOG_TAG, "Empty client info data. Will submit anyways.", LoggingLevel.Warn);
        clientInfo = {};
    }
    let finalClientInfo = {
        telemetry_sdk_build: GLEAN_VERSION
    };
    for (const metricType in clientInfo) {
        finalClientInfo = { ...finalClientInfo, ...clientInfo[metricType] };
    }
    if (!ping.includeClientId) {
        delete finalClientInfo["client_id"];
    }
    return finalClientInfo;
}
export async function collectPing(ping, reason) {
    const eventsData = await Context.eventsDatabase.getPingEvents(ping.name, true);
    const metricsData = await Context.metricsDatabase.getPingMetrics(ping.name, true);
    if (!metricsData && !eventsData) {
        if (!ping.sendIfEmpty) {
            log(PINGS_MAKER_LOG_TAG, `Storage for ${ping.name} empty. Bailing out.`, LoggingLevel.Info);
            return;
        }
        log(PINGS_MAKER_LOG_TAG, `Storage for ${ping.name} empty. Ping will still be sent.`, LoggingLevel.Info);
    }
    const metrics = metricsData ? { metrics: metricsData } : {};
    const events = eventsData ? { events: eventsData } : {};
    const pingInfo = await buildPingInfoSection(ping, reason);
    const clientInfo = await buildClientInfoSection(ping);
    return {
        ...metrics,
        ...events,
        ping_info: pingInfo,
        client_info: clientInfo
    };
}
export async function collectAndStorePing(identifier, ping, reason) {
    const collectedPayload = await collectPing(ping, reason);
    if (!collectedPayload) {
        return;
    }
    let modifiedPayload;
    try {
        modifiedPayload = await CoreEvents.afterPingCollection.trigger(collectedPayload);
    }
    catch (e) {
        log(PINGS_MAKER_LOG_TAG, [
            `Error while attempting to modify ping payload for the "${ping.name}" ping using`,
            `the ${JSON.stringify(CoreEvents.afterPingCollection.registeredPluginIdentifier)} plugin.`,
            "Ping will not be submitted. See more logs below.\n\n",
            e
        ], LoggingLevel.Error);
        return;
    }
    if (Context.config.logPings) {
        log(PINGS_MAKER_LOG_TAG, JSON.stringify(collectedPayload, null, 2), LoggingLevel.Info);
    }
    const finalPayload = modifiedPayload ? modifiedPayload : collectedPayload;
    const headers = getPingHeaders();
    return Context.pingsDatabase.recordPing(makePath(identifier, ping), identifier, finalPayload, headers);
}
export default collectAndStorePing;