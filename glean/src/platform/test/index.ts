/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import MockStorage from "../test/storage.js";
import type PlatformInfo from "../../core/platform_info/async.js";
import { KnownOperatingSystems } from "../../core/platform_info/shared.js";
import Uploader from "../../core/upload/uploader.js";
import { UploadResultStatus, UploadResult } from "../../core/upload/uploader.js";
import type Platform from "../async.js";

class MockUploader extends Uploader {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  post(_url: string, _body: string | Uint8Array, _headers?: Record<string, string>): Promise<UploadResult> {
    const result = new UploadResult(UploadResultStatus.Success, 200);
    return Promise.resolve(result);
  }
}

const MockPlatformInfo: PlatformInfo = {
  os(): Promise<KnownOperatingSystems> {
    return Promise.resolve(KnownOperatingSystems.Unknown);
  },

  osVersion(): Promise<string> {
    return Promise.resolve("Unknown");
  },

  arch(): Promise<string> {
    return Promise.resolve("Unknown");
  },

  locale(): Promise<string> {
    return Promise.resolve("Unknown");
  },
};

const safeSetTimeout = typeof setTimeout !== "undefined" ? setTimeout : () => { throw new Error(); };
// eslint-disable-next-line @typescript-eslint/no-empty-function
const safeClearTimeout = typeof clearTimeout !== "undefined" ? clearTimeout : () => {};

const TestPlatform: Platform = {
  Storage: MockStorage,
  uploader: new MockUploader(),
  info: MockPlatformInfo,
  timer: { setTimeout: safeSetTimeout, clearTimeout: safeClearTimeout },
  name: "test"
};

export default TestPlatform;
