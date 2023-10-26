/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { CommonMetricData } from "../index.js";
import type { MetricValidationResult } from "../metric.js";

import { MetricType } from "../index.js";
import { generateUUIDv4, testOnlyCheck } from "../../utils.js";
import { Context } from "../../context.js";
import { MetricValidationError, MetricValidation, Metric } from "../metric.js";
import { ErrorType } from "../../error.js";
import { validateString } from "../utils.js";

const LOG_TAG = "core.metrics.UUIDMetricType";
// Loose UUID regex for checking if a string has a UUID _shape_. Does not contain version checks.
//
// This is necessary in order to accept non RFC compliant UUID values,
// which might be passed to Glean by legacy systems we aim to support e.g. Firefox Desktop.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class UUIDMetric extends Metric<string, string> {
  constructor(v: unknown) {
    super(v);
  }

  validate(v: unknown): MetricValidationResult {
    const validation = validateString(v);
    if (validation.type === MetricValidation.Error) {
      return validation;
    }

    const str = v as string;
    if (!UUID_REGEX.test(str)) {
      return {
        type: MetricValidation.Error,
        errorMessage: `"${str}" is not a valid UUID`,
        errorType: ErrorType.InvalidValue
      };
    }

    return { type: MetricValidation.Success };
  }

  payload(): string {
    return this.inner;
  }
}

/**
 * Base implementation of the UUID metric type,
 * meant only for Glean internal use.
 *
 * This class exposes Glean-internal properties and methods
 * of the UUID metric type.
 */
export class InternalUUIDMetricType extends MetricType {
  constructor(meta: CommonMetricData) {
    super("uuid", meta, UUIDMetric);
  }

  set(value: string): void {
    if (!this.shouldRecord(Context.uploadEnabled)) {
      return;
    }

    if (!value) {
      value = generateUUIDv4();
    }

    let metric: UUIDMetric;
    try {
      metric = new UUIDMetric(value);
      Context.metricsDatabase.record(this, metric);
    } catch (e) {
      if (e instanceof MetricValidationError) {
        e.recordError(this);
      }
    }
  }

  generateAndSet(): string | undefined {
    if (!this.shouldRecord(Context.uploadEnabled)) {
      return;
    }

    const value = generateUUIDv4();
    this.set(value);

    return value;
  }

  /// TESTING ///
  testGetValue(ping: string = this.sendInPings[0]): string | undefined {
    if (testOnlyCheck("testGetValue", LOG_TAG)) {
      return Context.metricsDatabase.getMetric<string>(ping, this);
    }
  }
}

/**
 *  An UUID metric.
 *
 * Stores UUID v4 (randomly generated) values.
 */
export default class {
  #inner: InternalUUIDMetricType;

  constructor(meta: CommonMetricData) {
    this.#inner = new InternalUUIDMetricType(meta);
  }

  /**
   * Sets to the specified value.
   *
   * @param value the value to set.
   * @throws In case `value` is not a valid UUID.
   */
  set(value: string): void {
    this.#inner.set(value);
  }

  /**
   * Generates a new random uuid and sets the metric to it.
   *
   * @returns The generated value or `undefined` in case this
   *          metric shouldn't be recorded.
   */
  generateAndSet(): string | undefined {
    return this.#inner.generateAndSet();
  }

  /**
   * Test-only API.**
   *
   * Gets the currently stored value as a string.
   *
   * This doesn't clear the stored value.
   *
   * @param ping the ping from which we want to retrieve this metrics value from.
   *        Defaults to the first value in `sendInPings`.
   * @returns The value found in storage or `undefined` if nothing was found.
   */
  testGetValue(ping: string = this.#inner.sendInPings[0]): string | undefined {
    return this.#inner.testGetValue(ping);
  }

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
  testGetNumRecordedErrors(errorType: string, ping: string = this.#inner.sendInPings[0]): number {
    return this.#inner.testGetNumRecordedErrors(errorType, ping);
  }
}
