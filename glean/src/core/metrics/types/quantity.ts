/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { CommonMetricData } from "../index.js";
import type { MetricValidationResult } from "../metric.js";
import type ErrorManagerSync from "../../error/sync.js";
import type MetricsDatabaseSync from "../database/sync.js";
import type DispatcherSync from "../../dispatcher/sync.js";

import { MetricType } from "../index.js";
import { testOnlyCheck } from "../../utils.js";
import { Context } from "../../context.js";
import { Metric, MetricValidationError } from "../metric.js";
import { validatePositiveInteger } from "../utils.js";
import { ErrorType } from "../../error/error_type.js";

const LOG_TAG = "core.metrics.QuantityMetricType";

export class QuantityMetric extends Metric<number, number> {
  constructor(v: unknown) {
    super(v);
  }

  validate(v: unknown): MetricValidationResult {
    return validatePositiveInteger(v);
  }

  payload(): number {
    return this.inner;
  }
}

/**
 * Base implementation of the quantity metric type,
 * meant only for Glean internal use.
 *
 * This class exposes Glean-internal properties and methods
 * of the quantity metric type.
 */
class InternalQuantityMetricType extends MetricType {
  constructor(meta: CommonMetricData) {
    super("quantity", meta, QuantityMetric);
  }

  /// SHARED ///
  set(value: number): void {
    if (Context.isPlatformSync()) {
      this.setSync(value);
    } else {
      this.setAsync(value);
    }
  }

  /// ASYNC ///
  setAsync(value: number) {
    Context.dispatcher.launch(() => this.setUndispatched(value));
  }

  /**
   * An implementation of `set` that does not dispatch the recording task.
   *
   * # Important
   *
   * This method should **never** be exposed to users.
   *
   * @param value The string we want to set to.
   */
  async setUndispatched(value: number): Promise<void> {
    if (!this.shouldRecord(Context.uploadEnabled)) {
      return;
    }

    if (value < 0) {
      await Context.errorManager.record(
        this,
        ErrorType.InvalidValue,
        `Set negative value ${value}`
      );
      return;
    }

    if (value > Number.MAX_SAFE_INTEGER) {
      value = Number.MAX_SAFE_INTEGER;
    }

    try {
      const metric = new QuantityMetric(value);
      await Context.metricsDatabase.record(this, metric);
    } catch (e) {
      if (e instanceof MetricValidationError) {
        await e.recordError(this);
      }
    }
  }

  /// SYNC ///
  setSync(value: number) {
    (Context.dispatcher as DispatcherSync).launch(() => this.setUndispatchedSync(value));
  }

  setUndispatchedSync(value: number) {
    if (!this.shouldRecord(Context.uploadEnabled)) {
      return;
    }

    if (value < 0) {
      (Context.errorManager as ErrorManagerSync).record(
        this,
        ErrorType.InvalidValue,
        `Set negative value ${value}`
      );
      return;
    }

    if (value > Number.MAX_SAFE_INTEGER) {
      value = Number.MAX_SAFE_INTEGER;
    }

    try {
      const metric = new QuantityMetric(value);
      (Context.metricsDatabase as MetricsDatabaseSync).record(this, metric);
    } catch (e) {
      if (e instanceof MetricValidationError) {
        e.recordErrorSync(this);
      }
    }
  }

  /// TESTING ///
  async testGetValue(ping: string = this.sendInPings[0]): Promise<number | undefined> {
    if (testOnlyCheck("testGetValue", LOG_TAG)) {
      let metric: number | undefined;
      await Context.dispatcher.testLaunch(async () => {
        metric = await Context.metricsDatabase.getMetric<number>(ping, this);
      });
      return metric;
    }
  }
}

/**
 * A quantity metric.
 *
 * Used to store quantity.
 * The value can only be non-negative.
 */
export default class {
  #inner: InternalQuantityMetricType;

  constructor(meta: CommonMetricData) {
    this.#inner = new InternalQuantityMetricType(meta);
  }

  /**
   * Sets to the specified quantity value.
   * Logs an warning if the value is negative.
   *
   * @param value the value to set. Must be non-negative
   */
  set(value: number): void {
    this.#inner.set(value);
  }

  /**
   * Test-only API.**
   *
   * Gets the currently stored value as a number.
   *
   * This doesn't clear the stored value.
   *
   * @param ping the ping from which we want to retrieve this metrics value from.
   *        Defaults to the first value in `sendInPings`.
   * @returns The value found in storage or `undefined` if nothing was found.
   */
  async testGetValue(ping: string = this.#inner.sendInPings[0]): Promise<number | undefined> {
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
  async testGetNumRecordedErrors(
    errorType: string,
    ping: string = this.#inner.sendInPings[0]
  ): Promise<number> {
    return this.#inner.testGetNumRecordedErrors(errorType, ping);
  }
}
