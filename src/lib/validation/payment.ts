// SPDX-License-Identifier: MIT

/**
 * Payment amount validation.
 *
 * A payment of zero (or a negative number) is never a valid Stellar transfer:
 * Horizon rejects it, and letting it through would only create an empty record
 * that can never settle. The rule lives here so every route that accepts a
 * payment amount (single payments, batch recipients, ...) enforces the same
 * thing and reports the same message.
 */

import { z } from "zod";

/** Message returned for a zero or negative amount. */
export const AMOUNT_MUST_BE_POSITIVE_MESSAGE = "Amount must be greater than zero";

/**
 * A payment amount: a finite number strictly greater than zero.
 *
 * `.positive()` and `.gt(0)` are both applied on purpose — `.positive()` keeps
 * the intent obvious in the emitted JSON Schema, `.gt(0)` makes the exclusive
 * lower bound explicit. `.finite()` closes the `Infinity` hole that `.positive()`
 * alone leaves open.
 */
export const paymentAmountSchema = z
  .number()
  .positive(AMOUNT_MUST_BE_POSITIVE_MESSAGE)
  .gt(0, AMOUNT_MUST_BE_POSITIVE_MESSAGE)
  .finite("Amount must be a finite number");
