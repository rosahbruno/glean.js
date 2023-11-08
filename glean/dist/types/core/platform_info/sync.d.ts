import type { IPlatformInfo, KnownOperatingSystems } from "../platform_info/shared.js";
interface PlatformInfoSync extends IPlatformInfo {
    os(): KnownOperatingSystems;
    osVersion(): string;
    arch(): string;
    locale(): string;
}
export default PlatformInfoSync;
