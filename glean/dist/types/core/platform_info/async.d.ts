import type { IPlatformInfo, KnownOperatingSystems } from "../platform_info/shared.js";
interface PlatformInfo extends IPlatformInfo {
    os(): Promise<KnownOperatingSystems>;
    osVersion(): Promise<string>;
    arch(): Promise<string>;
    locale(): Promise<string>;
}
export default PlatformInfo;
