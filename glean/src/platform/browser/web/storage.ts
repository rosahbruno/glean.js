/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import log, { LoggingLevel } from "../../../core/log.js";
import type { StorageIndex } from "../../../core/storage/index.js";
import type Store from "../../../core/storage/index.js";
import { deleteKeyFromNestedObject, getValueFromNestedObject, updateNestedObject } from "../../../core/storage/utils.js";
import type { JSONObject, JSONValue } from "../../../core/utils.js";
import { isJSONValue, isObject, isUndefined } from "../../../core/utils.js";

const LOG_TAG = "platform.web.Storage";

const DATABASE_NAME = "Glean";
const STORE_NAME = "Main";

enum DatabaseTransactionModes {
  ReadOnly = "readonly",
  ReadWrite = "readwrite"
}

class IDBWrapper {
  private static _instance?: IDBWrapper;
  private db?: IDBDatabase;

  private static get instance(): IDBWrapper {
    if (!IDBWrapper._instance) {
      IDBWrapper._instance = new IDBWrapper();
    }

    return IDBWrapper._instance;
  }

  private static async withDatabase(fn: () => Promise<void>) {
    if (!IDBWrapper.instance.db) {
      return new Promise<void>((resolve, reject) => {
        // `self` will work in Node.js and in the browser.
        // We want this to work in Node.js **only** for testing purposes.
        const openRequest = self.indexedDB.open(DATABASE_NAME);

        // If opening the database errors, Glean.initialize will throw and nothing else will happen.
        // TODO: Figure out if we should actually retry here (Bug 1737595).
        openRequest.onerror = () => {
          log(LOG_TAG, ["Unable to open Glean database.", openRequest.error]);
          reject(openRequest.error);
        };

        openRequest.onsuccess = () => {
          IDBWrapper.instance.db = openRequest.result;

          fn()
            .then(() => resolve())
            .catch(e => reject(e));
        };

        // When first creating the Database create also our object store.
        openRequest.onupgradeneeded = () => {
          openRequest.result.createObjectStore(STORE_NAME);
        };
      });
    } else {
      await fn();
    }
  }

  static async withStoredValue(
    key: string,
    fn: (storedValue: JSONObject, store: IDBObjectStore) => Promise<void>,
    mode: DatabaseTransactionModes,
  ): Promise<void> {
    await IDBWrapper.withDatabase(
      async () => {
        const transaction = IDBWrapper.instance.db?.transaction(STORE_NAME, mode);
        if (!transaction) {
          // This function should never be called if `IDBWrapper.instance.db` is undefined,
          // but let's leave it here to make TypeScript happy and to be extra careful.
          throw new Error("IMPOSSIBLE: Unable to perform database transaction. Database is not initialized.");
        }

        const completed = new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = transaction.onabort = e => reject(e);
        });

        const store = transaction?.objectStore(STORE_NAME);

        const storedValue = await new Promise((resolve, reject) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

        let correctedValue: JSONObject;
        if (isUndefined(storedValue)) {
          correctedValue = {};
        } else if (isJSONValue(storedValue) && isObject(storedValue)) {
          correctedValue = storedValue;
        } else {
          log(LOG_TAG, [ "Unexpected data found in storage. Overwriting.", storedValue ], LoggingLevel.Warn);
          correctedValue = {};
        }
        await fn(correctedValue, store);

        // Only get out of this function when the transaction is complete.
        await completed;
      }
    );
  }
}

class WebStore implements Store {
  private logTag: string;

  constructor(private rootKey: string) {
    this.logTag = `${LOG_TAG}.${rootKey}`;
  }

  async get(index: StorageIndex = []): Promise<JSONValue | undefined> {
    let result;
    await IDBWrapper.withStoredValue(
      this.rootKey,
      (value: JSONObject) => {
        if (index.length > 0) {
          result = getValueFromNestedObject(value, index);
        } else {
          result = Object.keys(value).length === 0 ? undefined : value;
        }

        return Promise.resolve();
      },
      DatabaseTransactionModes.ReadOnly,
    );

    return result;
  }

  async update(
    index: StorageIndex,
    transformFn: (v?: JSONValue) => JSONValue
  ): Promise<void> {
    await IDBWrapper.withStoredValue(
      this.rootKey,
      async (value: JSONObject, store: IDBObjectStore) => {
        await new Promise((resolve, reject) => {
          const updatedObj = updateNestedObject(value, index, transformFn);
          const request = store.put(updatedObj, this.rootKey);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error);
        });
      },
      DatabaseTransactionModes.ReadWrite,
    );
  }

  async delete(index: StorageIndex): Promise<void> {
    await IDBWrapper.withStoredValue(
      this.rootKey,
      async (value: JSONObject, store: IDBObjectStore) => {
        if (index.length === 0) {
          store.delete(this.rootKey);
        } else {
          await new Promise<void>((resolve, reject) => {
            try {
              const updatedObj = deleteKeyFromNestedObject(value, index);
              const request = store.put(updatedObj, this.rootKey);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
            } catch(e) {
              log(
                this.logTag,
                [`Error attempting to delete key ${index.toString()} from storage. Ignoring.`, e],
                LoggingLevel.Warn
              );
              resolve();
            }
          });
        }
      },
      DatabaseTransactionModes.ReadWrite,
    );
  }
}

export default WebStore;
