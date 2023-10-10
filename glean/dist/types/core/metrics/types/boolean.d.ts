import type { CommonMetricData } from "../index.js";
import type { MetricValidationResult } from "../metric.js";
import { Metric } from "../metric.js";
export declare class BooleanMetric extends Metric<boolean, boolean> {
    constructor(v: unknown);
    validate(v: unknown): MetricValidationResult;
    payload(): boolean;
}
/**
 *  A boolean metric.
 *
 * Records a simple flag.
 */
export default class {
    #private;
    constructor(meta: CommonMetricData);
    /**
     * Sets to the specified boolean value.
     *
     * @param value the value to set.
     */
    set(value: boolean): void;
    /**
     * Test-only API
     *
     * Gets the currently stored value as a boolean.
     *
     * This doesn't clear the stored value.
     *
     * @param ping the ping from which we want to retrieve this metrics value from.
     *        Defaults to the first value in `sendInPings`.
     * @returns The value found in storage or `undefined` if nothing was found.
     */
    testGetValue(ping?: string): Promise<boolean | undefined>;
    /**
     * Test-only API
     *
     * Returns the number of errors recorded for the given metric.
     *
     * @param errorType The type of the error recorded.
     * @param ping represents the name of the ping to retrieve the metric for.
     *        Defaults to the first value in `sendInPings`.
     * @returns the number of errors recorded for the metric.
     */
    testGetNumRecordedErrors(errorType: string, ping?: string): Promise<number>;
}