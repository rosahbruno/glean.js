/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ConfigurationInterface } from "../config.js";
import type PlatformSync from "../../platform/sync.js";
import type DispatcherSync from "../dispatcher/sync.js";

import { CLIENT_INFO_STORAGE, KNOWN_CLIENT_ID } from "../constants.js";
import { Configuration } from "../config.js";
import PingUploadManager from "../upload/manager/sync.js";
import { isBoolean, isString, sanitizeApplicationId } from "../utils.js";
import { CoreMetricsSync } from "../internal_metrics/sync.js";
import { EventsDatabaseSync } from "../metrics/events_database/sync.js";
import { DatetimeMetric } from "../metrics/types/datetime.js";
import CorePings from "../internal_pings.js";
import { registerPluginToEvent } from "../events/utils/sync.js";
import ErrorManagerSync from "../error/sync.js";
import { Lifetime } from "../metrics/lifetime.js";
import { Context } from "../context.js";
import log, { LoggingLevel } from "../log.js";
import MetricsDatabaseSync from "../metrics/database/sync.js";
import PingsDatabaseSync from "../pings/database/sync.js";

const LOG_TAG = "core.Glean";

namespace Glean {
  // An instance of the ping uploader.
  export let pingUploader: PingUploadManager;

  // Temporary holders for debug values,
  // to be used when these values are set before initialize
  // and can be applied during initialized.
  export let preInitDebugViewTag: string | undefined;
  export let preInitLogPings: boolean | undefined;
  export let preInitSourceTags: string[] | undefined;

  /**
   * Handles the changing of state from upload disabled to enabled.
   *
   * Should only be called when the state actually changes.
   *
   * The `uploadEnabled` flag is set to true and the core Glean metrics are recreated.
   */
  function onUploadEnabled(): void {
    Context.uploadEnabled = true;
    (Context.coreMetrics as CoreMetricsSync).initialize();
  }

  /**
   * Handles the changing of state from upload enabled to disabled.
   *
   * Should only be called when the state actually changes.
   *
   * A deletion_request ping is sent, all pending metrics, events and queued
   * pings are cleared, and the client_id is set to KNOWN_CLIENT_ID.
   * Afterward, the upload_enabled flag is set to false.
   *
   * @param at_init Whether or not upload has been disabled during initialization.
   */
  function onUploadDisabled(at_init: boolean): void {
    // It's fine to set this before submitting the deletion request ping,
    // that ping is still sent even if upload is disabled.
    let reason: string;
    if (at_init) {
      reason = "at_init";
    } else {
      reason = "set_upload_enabled";
    }
    Context.uploadEnabled = false;
    // We need to use an undispatched submission to guarantee that the
    // ping is collected before metric are cleared, otherwise we end up
    // with malformed pings.
    Context.corePings.deletionRequest.submit(reason);
    clearMetrics();
  }

  /**
   * Clears any pending metrics and pings.
   *
   * This function is only supposed to be called when telemetry is disabled.
   */
  function clearMetrics(): void {
    // Clear enqueued upload jobs and clear pending pings queue.
    //
    // The only job that will still be sent is the deletion-request ping.
    pingUploader.clearPendingPingsQueue();

    // There is only one metric that we want to survive after clearing all
    // metrics: first_run_date. Here, we store its value
    // so we can restore it after clearing the metrics.
    //
    // Note: This will throw in case the stored metric is incorrect or inexistent.
    // The most likely is that it throws if the metrics hasn't been set,
    // e.g. we start Glean for the first with upload disabled.
    let firstRunDate: Date;
    try {
      firstRunDate = new DatetimeMetric(
        (Context.metricsDatabase as MetricsDatabaseSync).getMetric(
          CLIENT_INFO_STORAGE,
          Context.coreMetrics.firstRunDate
        )
      ).date;
    } catch {
      firstRunDate = new Date();
    }

    // Clear the databases.
    (Context.eventsDatabase as EventsDatabaseSync).clearAll();
    (Context.metricsDatabase as MetricsDatabaseSync).clearAll();
    (Context.pingsDatabase as PingsDatabaseSync).clearAll();

    // We need to briefly set upload_enabled to true here so that `set`
    // is not a no-op.
    //
    // This is safe.
    //
    // `clearMetrics` is either called on `initialize` or `setUploadEnabled`.
    // Both are dispatched tasks, which means that any other dispatched task
    // called after them will only be executed after they are done.
    // Since all external API calls are dispatched, it is not possible
    // for any other API call to be execute concurrently with this one.
    Context.uploadEnabled = true;

    // Store a "dummy" KNOWN_CLIENT_ID in the client_id metric. This will
    // make it easier to detect if pings were unintentionally sent after
    // uploading is disabled.
    (Context.coreMetrics as CoreMetricsSync).clientId.set(KNOWN_CLIENT_ID);

    // Restore the first_run_date.
    (Context.coreMetrics as CoreMetricsSync).firstRunDate.set(firstRunDate);

    Context.uploadEnabled = false;
  }

  /**
   * Initialize  This method should only be called once, subsequent calls will be no-op.
   *
   * @param applicationId The application ID (will be sanitized during initialization).
   * @param uploadEnabled Determines whether telemetry is enabled.
   *        If disabled, all persisted metrics, events and queued pings
   *        (except first_run_date) are cleared.
   * @param config Glean configuration options.
   * @throws
   * - If config.serverEndpoint is an invalid URL;
   * - If the application if is an empty string.
   */
  export function initialize(
    applicationId: string,
    uploadEnabled: boolean,
    config?: ConfigurationInterface
  ): void {
    try {
      const dbRequest = window.indexedDB.open("Glean");
      dbRequest.onerror = () => {
        log(LOG_TAG, ["Unable to open Glean database.", dbRequest.error]);
      };

      // If we can open IDB, we use the existing client_id as part of the migration.
      dbRequest.onsuccess = () => {
        const db = dbRequest.result;
        const transaction = db?.transaction("Main", "readwrite");
        const store = transaction.objectStore("Main");

        // Get all keys and update LocalStorage.
        const reqAllKeys = store.getAllKeys();
        reqAllKeys.onsuccess = () => {
          reqAllKeys.result.forEach((key: IDBValidKey) => {
            const keyReq = store.get(key);
            keyReq.onsuccess = () => {
              if (!!keyReq.result) {
                console.log(key);
                console.log(JSON.stringify(keyReq.result));
                localStorage.setItem(key as string, JSON.stringify(keyReq.result));
              }
            };
          });
        };

        // Client ID
        //
        // const req = store.get("userLifetimeMetrics");
        // req.onsuccess = () => {
        //   // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        //   const clientId = req.result?.["glean_client_info"]?.["uuid"]?.["client_id"] as string;
        //   console.log(clientId);
        //   if (!!clientId) {
        //     this.clientId.set(clientId);
        //   }
        // };

        // req.onerror = () => {
        //   console.log("req.onerror");
        // };
      };
    } catch (e) {
      initializeInner(applicationId, uploadEnabled, config);
    }

    // const migrationFlag = window.localStorage.getItem("GLEAN_MIGRATION_FLAG");
    // if (migrationFlag === "1") {
    //   initializeInner(applicationId, uploadEnabled, config);
    // } else {
    //   // TODO
    //   // Load values from IDB, THEN inside a callback, execute `initializeInner()`.

    //   initializeInner(applicationId, uploadEnabled, config);
    //   window.localStorage.setItem("GLEAN_MIGRATION_FLAG", "1");
    // }
  }

  /**
   * Inner work for initialize.
   *
   * @param applicationId The application ID.
   * @param uploadEnabled Determines whether telemetry is enabled.
   * @param config Glean configuration options.
   */
  function initializeInner(
    applicationId: string,
    uploadEnabled: boolean,
    config?: ConfigurationInterface
  ): void {
    if (Context.initialized) {
      log(
        LOG_TAG,
        "Attempted to initialize Glean, but it has already been initialized. Ignoring.",
        LoggingLevel.Warn
      );
      return;
    }

    if (!isString(applicationId)) {
      log(
        LOG_TAG,
        "Unable to initialize Glean, applicationId must be a string.",
        LoggingLevel.Error
      );
      return;
    }

    if (!isBoolean(uploadEnabled)) {
      log(
        LOG_TAG,
        "Unable to initialize Glean, uploadEnabled must be a boolean.",
        LoggingLevel.Error
      );
      return;
    }

    if (applicationId.length === 0) {
      log(
        LOG_TAG,
        "Unable to initialize Glean, applicationId cannot be an empty string.",
        LoggingLevel.Error
      );
      return;
    }

    if (!Context.platform) {
      log(LOG_TAG, "Unable to initialize Glean, platform has not been set.", LoggingLevel.Error);
      return;
    }

    Context.coreMetrics = new CoreMetricsSync();
    Context.corePings = new CorePings();

    Context.applicationId = sanitizeApplicationId(applicationId);

    // The configuration constructor will throw in case config has any incorrect prop.
    const correctConfig = new Configuration(config);
    Context.config = correctConfig;

    if (preInitLogPings) Context.config.logPings = preInitLogPings;
    if (preInitDebugViewTag) Context.config.debugViewTag = preInitDebugViewTag;
    if (preInitSourceTags) Context.config.sourceTags = preInitSourceTags;

    Context.metricsDatabase = new MetricsDatabaseSync();
    Context.eventsDatabase = new EventsDatabaseSync();
    Context.pingsDatabase = new PingsDatabaseSync();
    Context.errorManager = new ErrorManagerSync();

    pingUploader = new PingUploadManager(correctConfig, Context.pingsDatabase);

    if (config?.plugins) {
      for (const plugin of config.plugins) {
        registerPluginToEvent(plugin);
      }
    }

    (Context.dispatcher as DispatcherSync).flushInit(() => {
      Context.initialized = true;

      Context.uploadEnabled = uploadEnabled;

      // Initialize the events database.
      //
      // It's important this happens _after_ the upload state is set,
      // because initializing the events database may record the execution_counter and
      // glean.restarted metrics. If the upload state is not defined these metrics cannot be recorded.
      //
      // This may also submit an 'events' ping,
      // so it also needs to happen before application lifetime metrics are cleared.
      (Context.eventsDatabase as EventsDatabaseSync).initialize();

      // The upload enabled flag may have changed since the last run, for
      // example by the changing of a config file.
      if (uploadEnabled) {
        // IMPORTANT!
        // Any pings we want to send upon initialization should happen before this line.
        //
        // Clear application lifetime metrics.
        //
        // If upload is disabled we don't need to do this,
        // all metrics will be cleared anyways and we want
        // application lifetime metrics intact in case
        // we need to send a deletion-request ping.
        (Context.metricsDatabase as MetricsDatabaseSync).clear(Lifetime.Application);

        // If upload is enabled,
        // just follow the normal code path to instantiate the core metrics.
        onUploadEnabled();
      } else {
        // If upload is disabled, and we've never run before, only set the
        // client_id to KNOWN_CLIENT_ID, but do not send a deletion request
        // ping.
        // If we have run before, and if the client_id is not equal to
        // the KNOWN_CLIENT_ID, do the full upload disabled operations to
        // clear metrics, set the client_id to KNOWN_CLIENT_ID, and send a
        // deletion request ping.
        const clientId = Context.metricsDatabase.getMetric(
          CLIENT_INFO_STORAGE,
          Context.coreMetrics.clientId
        );

        if (clientId) {
          if (clientId !== KNOWN_CLIENT_ID) {
            onUploadDisabled(true);
          }
        } else {
          // Call `clearMetrics` directly here instead of `onUploadDisabled` to avoid sending
          // a deletion-request ping for a user that has already done that.
          clearMetrics();
        }
      }

      // We only scan the pending pings **after** dealing with the upload state.
      // If upload is disabled, pending pings files are deleted
      // so we need to know that state **before** scanning the pending pings
      // to ensure we don't enqueue pings before their files are deleted.
      (Context.pingsDatabase as PingsDatabaseSync).scanPendingPings();
    });
  }

  /**
   * Sets whether upload is enabled or not.
   *
   * When uploading is disabled, metrics aren't recorded at all and no
   * data is uploaded.
   *
   * When disabling, all pending metrics, events and queued pings are cleared.
   *
   * When enabling, the core Glean metrics are recreated.
   *
   * If the value of this flag is not actually changed, this is a no-op.
   *
   * @param flag When true, enable metric collection.
   */
  export function setUploadEnabled(flag: boolean): void {
    if (!Context.initialized) {
      log(
        LOG_TAG,
        [
          "Changing upload enabled before Glean is initialized is not supported.\n",
          "Pass the correct state into `initialize`.\n",
          "See documentation at https://mozilla.github.io/glean/book/user/general-api.html#initializing-the-glean-sdk`"
        ],
        LoggingLevel.Error
      );
      return;
    }

    if (!isBoolean(flag)) {
      log(
        LOG_TAG,
        "Unable to change upload state, new value must be a boolean. Ignoring.",
        LoggingLevel.Error
      );
      return;
    }

    (Context.dispatcher as DispatcherSync).launch(() => {
      if (Context.uploadEnabled !== flag) {
        if (flag) {
          onUploadEnabled();
        } else {
          onUploadDisabled(false);
        }
      }
    });
  }

  /**
   * Sets the `logPings` debug option.
   *
   * When this flag is `true` pings will be logged to the console right before they are collected.
   *
   * @param flag Whether or not to log pings.
   */
  export function setLogPings(flag: boolean): void {
    if (!Context.initialized) {
      // Cache value to apply during init.
      preInitLogPings = flag;
    } else {
      (Context.dispatcher as DispatcherSync).launch(() => {
        Context.config.logPings = flag;
      });
    }
  }

  /**
   * Sets the `debugViewTag` debug option.
   *
   * When this property is set, all subsequent outgoing pings will include the `X-Debug-ID` header
   * which will redirect them to the ["Ping Debug Viewer"](https://debug-ping-preview.firebaseapp.com/).
   *
   * @param value The value of the header.
   *        This value must satisfy the regex `^[a-zA-Z0-9-]{1,20}$` otherwise it will be ignored.
   */
  export function setDebugViewTag(value: string): void {
    if (!Context.initialized) {
      // Cache value to apply during init.
      preInitDebugViewTag = value;
    } else {
      (Context.dispatcher as DispatcherSync).launch(() => {
        Context.config.debugViewTag = value;
      });
    }
  }

  /**
   * Sets the `sourceTags` debug option.
   *
   * Ping tags will show in the destination datasets, after ingestion.
   *
   * Note: Setting `sourceTags` will override all previously set tags.
   *
   * @param value A vector of at most 5 valid HTTP header values.
   *        Individual tags must match the regex: "[a-zA-Z0-9-]{1,20}".
   */
  export function setSourceTags(value: string[]): void {
    if (!Context.initialized) {
      // Cache value to apply during init.
      preInitSourceTags = value;
    } else {
      (Context.dispatcher as DispatcherSync).launch(() => {
        Context.config.sourceTags = value;
      });
    }
  }

  /**
   * Calling shutdown on the synchronous implementation is a no-op. Glean's
   * synchronous implementation does not use the dispatcher, so there is no
   * action to perform.
   */
  export function shutdown(): void {
    log(LOG_TAG, "Calling shutdown for the Glean web implementation is a no-op. Ignoring.");
    (Context.dispatcher as DispatcherSync).shutdown();
    return;
  }

  /**
   * Sets the current environment.
   *
   * This function **must** be called before initialize.
   *
   * @param platform The environment to set.
   *        Please check out the available environments in the platform/ module.
   */
  export function setPlatform(platform: PlatformSync): void {
    // Platform can only be set if Glean is uninitialized,
    // because initialize will make sure to recreate any
    // databases in case another platform was set previously.
    //
    // **Note**: Users should only be able to replace the platform in testing
    // situations, if they call initialize before calling testReset
    // We want to replace whatever platform was set by initialize with the
    // testing platforms in this case and that is possible because testResetGlean
    // uninitializes Glean before setting the testing platform.
    if (Context.initialized) {
      return;
    }

    if (Context.isPlatformSet() && Context.platform.name !== platform.name && !Context.testing) {
      log(
        LOG_TAG,
        [
          `IMPOSSIBLE: Attempted to change Glean's targeted platform",
            "from "${Context.platform.name}" to "${platform.name}". Ignoring.`
        ],
        LoggingLevel.Error
      );
    }

    Context.platform = platform;
  }
}

export default Glean;
