/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type Store from "../../../core/storage.js";
import type { StorageIndex } from "../../../core/storage.js";
import type { JSONObject, JSONValue } from "../../../core/utils.js";

import { Context } from "../../../core/context.js";
import log, { LoggingLevel } from "../../../core/log.js";
import {
  deleteKeyFromNestedObject,
  getValueFromNestedObject,
  updateNestedObject
} from "../../../core/storage.js";
import { isWindowObjectUnavailable } from "../../../core/utils.js";

const LOG_TAG = "platform.web.Storage";

// If `window.localStorage` is unavailable, we return undefined for all.
class WebStore implements Store {
  private logTag: string;

  constructor(private rootKey: string) {
    this.logTag = `${LOG_TAG}.${rootKey}`;
  }

  get(index: StorageIndex = []): JSONValue | undefined {
    if (isWindowObjectUnavailable()) {
      return;
    }

    let result;

    try {
      const json = localStorage.getItem(this.rootKey) || "{}";
      const obj = JSON.parse(json) as JSONObject;

      if (index.length > 0) {
        result = getValueFromNestedObject(obj, index);
      } else {
        result = Object.keys(obj).length === 0 ? undefined : obj;
      }
    } catch (err) {
      log(LOG_TAG, ["Unable to fetch value from local storage.", err], LoggingLevel.Error);
    }

    if (this.shouldUpdateSession(index)) {
      Context.coreMetrics.updateSessionInfo();
    }

    return result;
  }

  update(index: StorageIndex, transformFn: (v?: JSONValue) => JSONValue): void {
    if (isWindowObjectUnavailable()) {
      return;
    }

    try {
      const json = localStorage.getItem(this.rootKey) || "{}";
      const obj = JSON.parse(json) as JSONObject;

      const updatedObj = updateNestedObject(obj, index, transformFn);
      localStorage.setItem(this.rootKey, JSON.stringify(updatedObj));
    } catch (err) {
      log(LOG_TAG, ["Unable to update value from local storage.", err], LoggingLevel.Error);
    }

    if (this.shouldUpdateSession(index)) {
      Context.coreMetrics.updateSessionInfo();
    }
  }

  delete(index: StorageIndex): void {
    if (isWindowObjectUnavailable()) {
      return;
    }

    try {
      const json = localStorage.getItem(this.rootKey) || "{}";
      const obj = JSON.parse(json) as JSONObject;

      if (index.length === 0) {
        localStorage.removeItem(this.rootKey);
      } else {
        try {
          const updatedObj = deleteKeyFromNestedObject(obj, index);
          localStorage.setItem(this.rootKey, JSON.stringify(updatedObj));
        } catch (e) {
          log(
            this.logTag,
            [`Error attempting to delete key ${index.toString()} from storage. Ignoring.`, e],
            LoggingLevel.Warn
          );
        }
      }
    } catch (err) {
      log(LOG_TAG, ["Unable to delete value from storage.", err], LoggingLevel.Error);
    }

    if (this.shouldUpdateSession(index)) {
      Context.coreMetrics.updateSessionInfo();
    }
  }

  /**
   * Check to see if the session information should be updated whenever
   * interacting with storage. If we are updating the existing session metrics
   * then running the `updateSessionInfo` function again would result in an
   * infinite loop of updating the metrics and re-running this function.
   *
   * @param {StorageIndex} index Index to update in storage.
   * @returns {boolean} Whether we should update session metrics.
   */
  private shouldUpdateSession(index: StorageIndex): boolean {
    return !index.includes("session_id") && !index.includes("session_count");
  }
}

export default WebStore;
