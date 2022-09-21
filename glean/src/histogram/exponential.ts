/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Bucketing } from "./bucketing.js";
import { binarySearch } from "./utils.js";

/**
 * Create the possible ranges in an exponential distribution from `min` to `max` with
 * `bucket_count` buckets.
 *
 * This algorithm calculates the bucket sizes using a natural log approach to get `bucket_count` number of buckets,
 * exponentially spaced between `min` and `max`
 *
 * Bucket limits are the minimal bucket value.
 * That means values in a bucket `i` are `bucket[i] <= value < bucket[i+1]`.
 * It will always contain an underflow bucket (`< 1`).
 *
 * **NOTE**
 * Exported solely for testing purposes.
 *
 * @param min Minimum number in the distribution
 * @param max Maximum number in the distribution
 * @param bucketCount Number of total buckets
 * @returns Computed bucket ranges
 */
export function exponentialRange(min: number, max: number, bucketCount: number): number[] {
  const logMax = Math.log(max);

  const ranges: number[] = [];
  let current = min;
  if (current === 0) {
    current = 1;
  }

  ranges.push(0);
  ranges.push(current);

  for (let i = 2; i < bucketCount; i++) {
    const logCurrent = Math.log(current);
    const logRatio = (logMax - logCurrent) / (bucketCount - i);
    const logNext = logCurrent + logRatio;
    const nextValue = Math.round(Math.exp(logNext));

    if (nextValue > current) {
      current = nextValue;
    } else {
      current += 1;
    }
    ranges.push(current);
  }

  return ranges;
}

export class PrecomputedExponential implements Bucketing {
  bucketRanges: number[];
  min: number;
  max: number;
  bucketCount: number;

  constructor(min: number, max: number, bucketCount: number) {
    this.min = min;
    this.max = max;
    this.bucketCount = bucketCount;
    this.bucketRanges = [];
  }

  /**
   * Get the bucket for the sample.
   *
   * This uses a binary search to locate the index `i` of the bucket such that:
   * bucket[i] <= sample < bucket[i+1].
   *
   * @param sample Value that we will find a bucket for
   * @returns The bucket that the sample will be placed in
   */
  sampleToBucketMinimum(sample: number): number {
    const limit = binarySearch(this.ranges(), sample);

    if (limit === -1) {
      throw new Error("Unable to find correct bucket for the sample.");
    }

    return this.ranges()[limit];
  }

  ranges(): number[] {
    if (this.bucketRanges.length) {
      return this.bucketRanges;
    }

    this.bucketRanges = exponentialRange(this.min, this.max, this.bucketCount);
    return this.bucketRanges;
  }
}
