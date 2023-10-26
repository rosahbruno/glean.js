/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type Store from "../storage.js";
import type { MetricType, Metrics } from "./index.js";
import type { Metric } from "./metric.js";
import type { JSONObject, JSONValue } from "../utils.js";

import { createMetric, validateMetricInternalRepresentation } from "./utils.js";
import { isObject, isUndefined } from "../utils.js";
import { Lifetime } from "./lifetime.js";
import log, { LoggingLevel } from "../log.js";
import { Context } from "../context.js";

/// CONSTANTS ///
const METRICS_DATABASE_LOG_TAG = "core.Metrics.Database";

// Metrics whose names start with this prefix will
// not be added to the ping payload.
//
// glean_parser rejects metrics with `#` in the name,
// so this is guaranteed not to clash with user defined metrics.
const RESERVED_METRIC_NAME_PREFIX = "reserved#";

// The full identifier of internal metrics.
export const RESERVED_METRIC_IDENTIFIER_PREFIX = `glean.${RESERVED_METRIC_NAME_PREFIX}`;

/// HELPERS ///
/**
 * Generates a name for a reserved metric.
 *
 * Reserved metrics are not sent in ping payloads.
 *
 * @param name The name of the metric.
 * @returns The name of metrics with proper identification to make it a reserved metric.
 */
export function generateReservedMetricIdentifiers(name: string): {
  category: string;
  name: string;
} {
  return {
    category: "glean",
    name: `${RESERVED_METRIC_NAME_PREFIX}${name}`
  };
}

/**
 * Creates the metrics payload from a metrics object with metrics in their internal representation.
 *
 * @param v The Metrics object to transform.
 * @returns A metrics object with metrics in their payload format.
 */
export function createMetricsPayload(v: Metrics): Metrics {
  const result: Metrics = {};

  for (const metricType in v) {
    const metrics = v[metricType];
    result[metricType] = {};
    for (const metricIdentifier in metrics) {
      const metric = createMetric(metricType, metrics[metricIdentifier]);
      result[metricType][metricIdentifier] = metric.payload();
    }
  }

  return result;
}

/**
 * The metrics database is an abstraction layer on top of the underlying storage.
 *
 * Metric data is saved to the database in the following format:
 *
 * {
 *  "pingName": {
 *    "metricType (i.e. boolean)": {
 *      "metricIdentifier": metricPayload
 *    }
 *  }
 * }
 *
 * We have one store in this format for each lifetime: user, ping and application.
 *
 */
class MetricsDatabase {
  private userStore: Store;
  private pingStore: Store;
  private appStore: Store;

  constructor() {
    this.userStore = new Context.platform.Storage("userLifetimeMetrics");
    this.pingStore = new Context.platform.Storage("pingLifetimeMetrics");
    this.appStore = new Context.platform.Storage("appLifetimeMetrics");
  }

  /// PUBLIC ///
  /**
   * Records a given value to a given metric.
   * Will overwrite in case there is already a value in there.
   *
   * @param metric The metric to record to.
   * @param value The value we want to record to the given metric.
   */
  record(metric: MetricType, value: Metric<JSONValue, JSONValue>): void {
    this.transform(metric, () => value);
  }

  /**
   * Records a given value to a given metric,
   * by applying a transformation function on the value currently persisted.
   *
   * @param metric The metric to record to.
   * @param transformFn The transformation function to apply to the currently persisted value.
   */
  transform(
    metric: MetricType,
    transformFn: (v?: JSONValue) => Metric<JSONValue, JSONValue>
  ): void {
    if (metric.disabled) {
      return;
    }

    const store = this.chooseStore(metric.lifetime);

    const storageKey = metric.identifier();

    for (const ping of metric.sendInPings) {
      const finalTransformFn = (v?: JSONValue): JSONValue => transformFn(v).get();
      store.update([ping, metric.type, storageKey], finalTransformFn);
    }
  }

  /**
   * Checks if anything was stored for the provided metric.
   *
   * @param lifetime the metric `Lifetime`.
   * @param ping the ping storage to search in.
   * @param metricType the type of the metric.
   * @param metricIdentifier the metric identifier.
   * @returns `true` if the metric was found (regardless of the validity of the
   *          stored data), `false` otherwise.
   */
  hasMetric(
    lifetime: Lifetime,
    ping: string,
    metricType: string,
    metricIdentifier: string
  ): boolean {
    const store = this.chooseStore(lifetime);
    const value = store.get([ping, metricType, metricIdentifier]);
    return !isUndefined(value);
  }

  /**
   * Counts the number of stored metrics with an id starting with a specific identifier.
   *
   * @param lifetime the metric `Lifetime`.
   * @param ping the ping storage to search in.
   * @param metricType the type of the metric.
   * @param metricIdentifier the metric identifier.
   * @returns the number of stored metrics with their id starting with the given identifier.
   */
  countByBaseIdentifier(
    lifetime: Lifetime,
    ping: string,
    metricType: string,
    metricIdentifier: string
  ): number {
    const store = this.chooseStore(lifetime);
    const pingStorage = store.get([ping, metricType]);
    if (isUndefined(pingStorage)) {
      return 0;
    }

    return Object.keys(pingStorage).filter((n) => n.startsWith(metricIdentifier)).length;
  }

  /**
   * Gets  and validates the persisted payload of a given metric in a given ping.
   *
   * If the persisted value is invalid for the metric we are attempting to retrieve,
   * the persisted value is deleted and `undefined is returned.
   *
   * This behaviour is not consistent with what the Glean SDK does, but this is on purpose.
   * On the Glean SDK we panic when we can't serialize the persisted value,
   * that is because this is an extremely unlikely situation for that environment.
   *
   * Since Glean.js will run on the browser, it is easy for a consumers / developers
   * to mess with the storage which makes this sort of errors plausible.
   * That is why we choose to not panic and simply delete the corrupted data here.
   *
   * Note: This is not a strong guard against consumers / developers messing with the storage on their own.
   * Currently Glean.js does not include mechanisms to reliably prevent that.
   *
   * @param ping The ping from which we want to retrieve the given metric.
   * @param metric An object containing the information about the metric to retrieve.
   * @returns The payload persisted for the given metric,
   *          `undefined` in case the metric has not been recorded yet or the found values in invalid.
   */
  getMetric<T extends JSONValue>(ping: string, metric: MetricType): T | undefined {
    const store = this.chooseStore(metric.lifetime);
    const storageKey = metric.identifier();
    const value = store.get([ping, metric.type, storageKey]);
    if (!isUndefined(value) && !validateMetricInternalRepresentation<T>(metric.type, value)) {
      log(
        METRICS_DATABASE_LOG_TAG,
        `Unexpected value found for metric ${storageKey}: ${JSON.stringify(value)}. Clearing.`,
        LoggingLevel.Error
      );
      store.delete([ping, metric.type, storageKey]);
      return;
    } else {
      return value;
    }
  }

  /**
   * Gets all of the persisted metrics related to a given ping.
   *
   * @param ping The name of the ping to retrieve.
   * @param clearPingLifetimeData Whether or not to clear the ping lifetime metrics retrieved.
   * @returns An object containing all the metrics recorded to the given ping,
   *          `undefined` in case the ping doesn't contain any recorded metrics.
   */
  getPingMetrics(ping: string, clearPingLifetimeData: boolean): Metrics | undefined {
    const userData = this.getCorrectedPingData(ping, Lifetime.User);
    const pingData = this.getCorrectedPingData(ping, Lifetime.Ping);
    const appData = this.getCorrectedPingData(ping, Lifetime.Application);

    if (clearPingLifetimeData && Object.keys(pingData).length > 0) {
      this.clear(Lifetime.Ping, ping);
    }

    const response: Metrics = {};
    for (const data of [userData, pingData, appData]) {
      for (const metricType in data) {
        for (const metricId in data[metricType]) {
          if (!metricId.startsWith(RESERVED_METRIC_IDENTIFIER_PREFIX)) {
            if (metricId.includes("/")) {
              // While labeled data is stored within the subtype storage (e.g. counter storage), it
              // needs to live in a different section of the ping payload (e.g. `labeled_counter`).
              this.processLabeledMetric(response, metricType, metricId, data[metricType][metricId]);
            } else {
              response[metricType] = {
                ...response[metricType],
                [metricId]: data[metricType][metricId]
              };
            }
          }
        }
      }
    }

    if (Object.keys(response).length === 0) {
      return;
    } else {
      return createMetricsPayload(response);
    }
  }

  /**
   * Clears currently persisted data for a given lifetime.
   *
   * @param lifetime The lifetime to clear.
   * @param ping The ping to clear data from. When omitted, data from all pings will be cleared.
   */
  clear(lifetime: Lifetime, ping?: string): void {
    const store = this.chooseStore(lifetime);
    const storageIndex = ping ? [ping] : [];
    store.delete(storageIndex);
  }

  /**
   * Clears all persisted metrics data.
   */
  clearAll(): void {
    this.userStore.delete([]);
    this.pingStore.delete([]);
    this.appStore.delete([]);
  }

  /// PRIVATE ///
  /**
   * Returns the store instance for a given lifetime.
   *
   * @param lifetime The lifetime related to the store we want to retrieve.
   * @returns The store related to the given lifetime.
   * @throws If the provided lifetime does not have a related store.
   */
  private chooseStore(lifetime: Lifetime): Store {
    switch (lifetime) {
    case Lifetime.User:
      return this.userStore;
    case Lifetime.Ping:
      return this.pingStore;
    case Lifetime.Application:
      return this.appStore;
    }
  }

  /**
   * Helper function to validate and get a specific lifetime data
   * related to a ping from the underlying storage.
   *
   * # Note
   *
   * If invalid data is encountered it will be deleted and won't be part of the final ping payload.
   *
   * @param ping The ping we want to get the data from
   * @param lifetime The lifetime of the data we want to retrieve
   * @returns The ping payload found for the given parameters or an empty object
   *          in case no data was found or the data that was found, was invalid.
   */
  private getCorrectedPingData(ping: string, lifetime: Lifetime): Metrics {
    const store = this.chooseStore(lifetime);
    const data = store.get([ping]);
    if (isUndefined(data)) {
      return {};
    }

    if (!isObject(data)) {
      log(
        METRICS_DATABASE_LOG_TAG,
        `Invalid value found in storage for ping "${ping}". Deleting.`,
        LoggingLevel.Debug
      );
      store.delete([ping]);
      return {};
    }

    const correctedData: Metrics = {};
    // All top keys should be metric types.
    for (const metricType in data) {
      const metrics = data[metricType];
      if (!isObject(metrics)) {
        log(
          METRICS_DATABASE_LOG_TAG,
          `Unexpected data found in storage for metrics of type "${metricType}" in ping "${ping}". Deleting.`,
          LoggingLevel.Debug
        );
        store.delete([ping, metricType]);
        continue;
      }

      for (const metricIdentifier in metrics) {
        if (!validateMetricInternalRepresentation(metricType, metrics[metricIdentifier])) {
          log(
            METRICS_DATABASE_LOG_TAG,
            `Invalid value "${JSON.stringify(
              metrics[metricIdentifier]
            )}" found in storage for metric "${metricIdentifier}". Deleting.`,
            LoggingLevel.Debug
          );

          store.delete([ping, metricType, metricIdentifier]);
          continue;
        }

        if (!correctedData[metricType]) {
          correctedData[metricType] = {};
        }

        // Coercion is fine here, `validateMetricInternalRepresentation`
        // validated that this is of the correct type.
        correctedData[metricType][metricIdentifier] = metrics[metricIdentifier] as JSONValue;
      }
    }

    return correctedData;
  }

  private processLabeledMetric(
    snapshot: Metrics,
    metricType: string,
    metricId: string,
    metricData: JSONValue
  ) {
    const newType = `labeled_${metricType}`;
    const idLabelSplit = metricId.split("/", 2);
    const newId = idLabelSplit[0];
    const label = idLabelSplit[1];

    if (newType in snapshot && newId in snapshot[newType]) {
      // Other labels were found for this metric. Do not throw them away.
      const existingData = snapshot[newType][newId];
      snapshot[newType][newId] = {
        ...(existingData as JSONObject),
        [label]: metricData
      };
    } else {
      // This is the first label for this metric.
      snapshot[newType] = {
        ...snapshot[newType],
        [newId]: {
          [label]: metricData
        }
      };
    }
  }
}

export default MetricsDatabase;
