/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type SynchronousStore from "../../../core/storage/sync.js";
import type { StorageIndex } from "../../../core/storage/shared.js";
import type { JSONObject, JSONValue } from "../../../core/utils.js";

import log, { LoggingLevel } from "../../../core/log.js";
import {
  deleteKeyFromNestedObject,
  getValueFromNestedObject,
  updateNestedObject
} from "../../../core/storage/utils.js";

const LOG_TAG = "platform.web.Storage";
const STORE_NAME = "Main";

class WebStore implements SynchronousStore {
  private logTag: string;

  constructor(private rootKey: string) {
    this.logTag = `${LOG_TAG}.${rootKey}`;
  }

  get(index: StorageIndex = []): JSONValue | undefined {
    let result;

    try {
      const json = localStorage.getItem(STORE_NAME) || "{}";
      const obj = JSON.parse(json) as JSONObject;

      if (index.length > 0) {
        result = getValueFromNestedObject(obj, [this.rootKey, ...index]);
      } else {
        result = Object.keys(obj).length === 0 ? undefined : obj;
      }
    } catch (err) {
      // TODO: log
      log(LOG_TAG, ["Unable to fetch value from local storage.", err], LoggingLevel.Error);
    }

    return result;
  }

  update(index: StorageIndex, transformFn: (v?: JSONValue) => JSONValue): void {
    // TODO: Fix issue where stores are written to nested objects.
    try {
      const json = localStorage.getItem(STORE_NAME) || "{}";
      const obj = JSON.parse(json) as JSONObject;

      const updatedObj = updateNestedObject(obj, [this.rootKey, ...index], transformFn);
      localStorage.setItem(STORE_NAME, JSON.stringify(updatedObj));
    } catch (err) {
      log(LOG_TAG, ["Unable to update value from local storage.", err], LoggingLevel.Error);
    }
  }

  delete(index: StorageIndex): void {
    try {
      const json = localStorage.getItem(STORE_NAME) || "{}";
      const obj = JSON.parse(json) as JSONObject;

      if (index.length === 0) {
        const updatedObj = deleteKeyFromNestedObject(obj, [this.rootKey]);
        localStorage.setItem(STORE_NAME, JSON.stringify(updatedObj));
      } else {
        try {
          const updatedObj = deleteKeyFromNestedObject(obj, [this.rootKey, ...index]);
          localStorage.setItem(STORE_NAME, JSON.stringify(updatedObj));
        } catch (e) {
          log(
            this.logTag,
            [`Error attempting to delete key ${index.toString()} from storage. Ignoring.`, e],
            LoggingLevel.Warn
          );
        }
      }
    } catch (err) {
      // TODO: log
      log(LOG_TAG, ["Unable to delete value from storage.", err], LoggingLevel.Error);
    }
  }
}

export default WebStore;
