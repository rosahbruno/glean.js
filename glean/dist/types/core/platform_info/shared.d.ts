import type { OptionalAsync } from "../types";
export declare const enum KnownOperatingSystems {
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
    ChromeOS = "ChromeOS",
    TvOS = "TvOS",
    Qnx = "QNX",
    Wasm = "Wasm",
    SunOS = "SunOS",
    AIX = "IBM_AIX",
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
