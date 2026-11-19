// SPDX-License-Identifier: MIT

/**
 * Batch payment request validation schema.
 *
 * Enforces limits on batch payment submissions, including a strict cap of 100
 * recipients per batch request to prevent oversized payloads that could exceed
 * Soroban transaction size limits (issue #1946).
 */

import { z } from "zod";
import { addMemoIssues } from "@/lib/validation/stellar";
import {
  stellarAddress,
  memoValueField,
  memoTypeField,
  idempotencyKeySchema,
} from "@/lib/validation-schemas";

/** Maximum number of recipients permitted in a single batch payment request. */
export const MAX_BATCH_RECIPIENTS = 100;

/** Minimum number of recipients required in a batch payment request. */
export const MIN_BATCH_RECIPIENTS = 1;

/**
 * Single recipient within a batch payment payload.
 */
export const batchRecipientSchema = z
  .object({
    address: stellarAddress,
    amount: z.number().positive("Amount must be greater than zero"),
    assetCode: z.string().default("XLM"),
    memo: memoValueField,
    memoType: memoTypeField,
  })
  .superRefine((recipient, ctx) => {
    addMemoIssues(ctx, recipient.memo, recipient.memoType, ["memo"]);
  });

export type BatchRecipient = z.infer<typeof batchRecipientSchema>;

/**
 * Request body schema for batch payment creation.
 * Enforces a strict ceiling of MAX_BATCH_RECIPIENTS (100) recipients.
 */
export const createBatchSchema = z.object({
  name: z
    .string()
    .min(1, "Batch name is required")
    .max(100, "Batch name cannot exceed 100 characters"),
  description: z.string().max(500, "Description cannot exceed 500 characters").optional(),
  recipients: z
    .array(batchRecipientSchema)
    .min(MIN_BATCH_RECIPIENTS, "At least one recipient is required")
    .max(
      MAX_BATCH_RECIPIENTS,
      `Batch payment recipients cannot exceed ${MAX_BATCH_RECIPIENTS} per request`
    ),
  sourceAccountId: z.string().min(1, "Source account ID is required"),
  idempotencyKey: idempotencyKeySchema.optional(),
});

export type CreateBatchInput = z.infer<typeof createBatchSchema>;
