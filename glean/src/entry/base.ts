/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import Glean from "../core/glean.js";
import type { ConfigurationInterface } from "../core/config.js";
import type Platform from "../platform/index.js";

// Strip the configuration interface of the Qt-only fields.
export type RestrictedConfigurationInterface = Omit<
  ConfigurationInterface,
  "architecture" | "osVersion"
>;

export const base = (platform: Platform) => {
  // See `IGlean` for method documentation.
  return {
    /**
     * Initialize Glean. This method should only be called once, subsequent calls will be no-op.
     *
     * @param applicationId The application ID (will be sanitized, if necessary).
     * @param uploadEnabled Determines whether telemetry is enabled.
     *                      If disabled, all persisted metrics, events and queued pings (except
     *                      first_run_date) are cleared.
     * @param config Glean configuration options.
     */
    initialize(
      applicationId: string,
      uploadEnabled: boolean,
      config?: RestrictedConfigurationInterface
    ): void {
      Glean.setPlatform(platform);
      Glean.initialize(applicationId, uploadEnabled, config);
    },
    /**
     * Sets whether upload is enabled or not.
     *
     * When uploading is disabled, metrics aren't recorded at all and no data is uploaded.
     *
     * When disabling, all pending metrics, events and queued pings are cleared.
     *
     * When enabling, the core Glean metrics are recreated.
     *
     * If the value of this flag is not actually changed, this is a no-op.
     *
     * If Glean has not been initialized yet, this is also a no-op.
     *
     * @param flag When true, enable metric collection.
     */
    setUploadEnabled(flag: boolean): void {
      Glean.setUploadEnabled(flag);
    },

    /**
     * Sets the `logPings` debug option.
     *
     * When this flag is `true` pings will be logged
     * to the console right before they are collected.
     *
     * @param flag Whether or not to log pings.
     */
    setLogPings(flag: boolean): void {
      Glean.setLogPings(flag);
    },

    /**
     * Sets the `debugViewTag` debug option.
     *
     * When this property is set, all subsequent outgoing pings will include the `X-Debug-ID` header
     * which will redirect them to the ["Ping Debug Viewer"](https://debug-ping-preview.firebaseapp.com/).
     *
     * @param value The value of the header.
     *        This value must satisfy the regex `^[a-zA-Z0-9-]{1,20}$` otherwise it will be ignored.
     */
    setDebugViewTag(value: string): void {
      Glean.setDebugViewTag(value);
    },

    /**
     * Finishes executing any ongoing tasks and shuts down Glean.
     *
     * This will attempt to send pending pings before resolving.
     *
     * @returns A promise which resolves once shutdown is complete.
     */
    shutdown(): void {
      return Glean.shutdown();
    },

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
    setSourceTags(value: string[]): void {
      Glean.setSourceTags(value);
    }
  };
};
