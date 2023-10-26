/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { MetricType } from "./metrics/index.js";

import log from "./log.js";
import { InternalCounterMetricType as CounterMetricType } from "./metrics/types/counter.js";
import { combineIdentifierAndLabel, stripLabel } from "./metrics/types/labeled.js";

/**
 * The possible error types for metric recording.
 */
export enum ErrorType {
  // For when the value to be recorded does not match the metric-specific restrictions
  InvalidValue = "invalid_value",
  // For when the label of a labeled metric does not match the restrictions
  InvalidLabel = "invalid_label",
  // For when the metric caught an invalid state while recording
  InvalidState = "invalid_state",
  // For when the value to be recorded overflows the metric-specific upper range
  InvalidOverflow = "invalid_overflow",
  // For when the value passed to a recording function is not of the correct type.
  InvalidType = "invalid_type",
}

/**
 * Create a log tag for a specific metric type.
 *
 * @param metric The metric type to create a tag for.
 * @returns The tag.
 */
export function createLogTag(metric: MetricType): string {
  const capitalizedType = metric.type.charAt(0).toUpperCase() + metric.type.slice(1);
  return `core.metrics.${capitalizedType}`;
}

/**
 * For a given metric, get the metric in which to record errors.
 *
 * # Important
 *
 * Errors do not adhere to the usual "maximum label" restriction.
 *
 * @param metric The metric to record an error for.
 * @param error The error type to record.
 * @returns The metric to record to.
 */
export function getErrorMetricForMetric(metric: MetricType, error: ErrorType): CounterMetricType {
  const identifier = metric.baseIdentifier();
  const name = stripLabel(identifier);

  // We don't use the labeled metric type here,
  // because we want to bypass the max number of allowed labels.
  return new CounterMetricType({
    name: combineIdentifierAndLabel(error, name),
    category: "glean.error",
    lifetime: "ping",
    // TODO: Also add the metric ping to the list. Depends on Bug 1710838.
    sendInPings: metric.sendInPings,
    disabled: false
  });
}

// See `IErrorManager` for method documentation.
export default class ErrorManager {
  /**
   * Records an error into Glean.
   *
   * Errors are recorded as labeled counters in the `glean.error` category.
   *
   * @param metric The metric to record an error for.
   * @param error The error type to record.
   * @param message The message to log. This message is not sent with the ping.
   *        It does not need to include the metric id, as that is automatically
   *        prepended to the message.
   * @param numErrors The number of errors of the same type to report.
   */
  record(metric: MetricType, error: ErrorType, message: unknown, numErrors = 1): void {
    const errorMetric = getErrorMetricForMetric(metric, error);
    log(createLogTag(metric), [`${metric.baseIdentifier()}:`, message]);
    if (numErrors > 0) {
      errorMetric.add(numErrors);
    }
  }

  /**
   * Gets the number of recorded errors for the given metric and error type.
   *
   * @param metric The metric to get the number of errors for.
   * @param error The error type to get count of.
   * @param ping The ping from which we want to retrieve the number of recorded errors.
   *        Defaults to the first value in `sendInPings`.
   * @returns The number of errors reported.
   */
  testGetNumRecordedErrors(metric: MetricType, error: ErrorType, ping?: string): number {
    const errorMetric = getErrorMetricForMetric(metric, error);
    const numErrors = errorMetric.testGetValue(ping);
    return numErrors || 0;
  }
}
