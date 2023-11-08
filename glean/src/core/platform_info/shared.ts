/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { OptionalAsync } from "../types";

// Must be up to date with https://github.com/mozilla/glean/blob/main/glean-core/src/system.rs
export const enum KnownOperatingSystems {
  Android = "Android",
  iOS = "iOS",
  Linux = "Linux",
  MacOS = "Darwin",
  Windows = "Windows",
  FreeBSD = "FreeBSD",
  NetBSD = "NetBSD",
  OpenBSD = "OpenBSD",
  Solaris = "Solaris",
  Unknown = "Unknown",

  // ChromeOS is not listed in the Glean SDK because it is not a possibility there.
  ChromeOS = "ChromeOS",

  // The following additions might be reported by Qt.
  TvOS = "TvOS", // https://developer.apple.com/tvos/
  Qnx = "QNX", // BlackBerry QNX
  Wasm = "Wasm",

  // The following additions might be reported by Node.js
  SunOS = "SunOS",
  AIX = "IBM_AIX",

  // Known reported values in the browser User-Agent
  WatchOS = "WatchOS",
  WebOS = "WebOS"
}

export interface IPlatformInfo {
  /**
   * Gets and returns the current OS system.
   *
   * @returns The current OS.
   */
  os(): OptionalAsync<KnownOperatingSystems>;

  /**
   * Gets and returns the current OS system version.
   *
   * @returns The current OS version.
   */
  osVersion(): OptionalAsync<string>;

  /**
   * Gets and returns the current system architecture.
   *
   * @returns The current system architecture.
   */
  arch(): OptionalAsync<string>;

  /**
   * Gets and returns the current system / browser locale.
   *
   * @returns The current system / browser locale.
   */
  locale(): OptionalAsync<string>;
}
