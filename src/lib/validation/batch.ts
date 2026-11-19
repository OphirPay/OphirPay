// SPDX-License-Identifier: MIT

/**
 * Batch payment request limits.
 *
 * A batch is submitted as a single Soroban transaction, so an oversized
 * recipient list can exceed the network's transaction size limits. The cap is
 * enforced in the request schema so an oversized payload is rejected with a
 * descriptive 400 before any database or RPC work happens.
 *
 * Mirrors `MAX_READER_ENTRIES` in `contracts/ophirpay/src/lib.rs` (#742).
 */

/** Maximum number of recipients accepted in a single batch request. */
export const MAX_BATCH_RECIPIENTS = 100;

/** Message returned when a batch has no recipients. */
export const BATCH_RECIPIENTS_MIN_MESSAGE =
  "A batch must contain at least one recipient";

/** Message returned when a batch exceeds {@link MAX_BATCH_RECIPIENTS}. */
export const BATCH_RECIPIENTS_MAX_MESSAGE = `A batch cannot contain more than ${MAX_BATCH_RECIPIENTS} recipients per request. Split the recipients across multiple batches.`;
