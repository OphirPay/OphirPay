// SPDX-License-Identifier: MIT

import { z } from "zod";

// ── Address / Identifier Schemas ──────────────────────────────

export const stellarAddress = z
  .string()
  .regex(/^G[A-Z0-9]{55}$/, "Invalid Stellar address — must be 56 chars starting with G");

export const apiKeyId = z.string().min(1, "API key ID is required");

// ── Payment Schemas ───────────────────────────────────────────

export const createPaymentSchema = z.object({
  amount: z.number().positive("Amount must be greater than zero"),
  sourceAccountId: z.string().min(1, "Source account is required"),
  destAddress: stellarAddress,
  assetCode: z.string().default("XLM"),
  assetIssuer: z.string().optional(),
  description: z.string().max(200).optional(),
  memo: z.string().max(28).optional(),
});

/** Body for POST /api/payments/retry — which failed payment to retry. */
export const retryPaymentSchema = z.object({
  id: z.string().min(1, "Payment id is required"),
});

export const updatePaymentSchema = z.object({
  status: z.enum(["CREATED", "PENDING", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
  description: z.string().max(500).optional(),
  memo: z.string().max(28).optional(),
});

// ── Batch Schemas ─────────────────────────────────────────────

export const batchRecipientSchema = z.object({
  address: stellarAddress,
  amount: z.number().positive("Amount must be greater than zero"),
  assetCode: z.string().default("XLM"),
  memo: z.string().max(28).optional(),
});

export const createBatchSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  recipients: z.array(batchRecipientSchema).min(1).max(100),
  sourceAccountId: z.string().min(1),
});

// ── Multisig Schemas ──────────────────────────────────────────

export const setMultisigConfigSchema = z.object({
  threshold: z.number().int().positive(),
  signers: z.array(z.string()).min(1),
  enabled: z.boolean(),
});

export const proposeMultisigPaymentSchema = z.object({
  payee: z.string().min(1, "Payee address is required"),
  amount: z.number().positive("Amount must be greater than zero"),
  assetCode: z.string().optional(),
  memo: z.string().max(28).optional(),
});

export const approveMultisigSchema = z.object({
  requestId: z.number().int().positive(),
});

export const executeMultisigSchema = z.object({
  requestId: z.number().int().positive(),
});

// ── Governance Schemas ────────────────────────────────────────

export const createProposalSchema = z.object({
  proposer: z.string().min(1, "Proposer is required"),
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  actionType: z.string().min(1).default("custom"),
  target: z.string().optional(),
  data: z.string().optional(),
  depositAsset: z.string().optional(),
  depositAmount: z.number().int().min(0).optional(),
});

export const voteOnProposalSchema = z.object({
  voter: z.string().min(1, "Voter address is required"),
  proposalId: z.number().int().positive(),
  support: z.boolean(),
});

export const executeProposalSchema = z.object({
  proposalId: z.number().int().positive(),
});

// ── Recurring Schemas ─────────────────────────────────────────

export const createRecurringSchema = z.object({
  name: z.string().min(1).max(100),
  frequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
  amount: z.number().positive(),
  assetCode: z.string().default("XLM"),
  destAddress: stellarAddress,
  description: z.string().max(500).optional(),
  sourceAccountId: z.string().min(1),
});

// ── Webhook Schemas ───────────────────────────────────────────

export const createWebhookSchema = z.object({
  url: z.string().url("Invalid webhook URL"),
  events: z.array(z.string()).min(1, "At least one event is required"),
  isActive: z.boolean().default(true),
});

// ── API Key Schemas ───────────────────────────────────────────

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  userId: z.string().min(1),
});

// ── Payment Request Schemas (moved from validations.ts) ───────

export const createPaymentRequestSchema = z.object({
  amount: z.number().positive("Amount must be greater than 0"),
  assetCode: z.string().default("XLM"),
  assetIssuer: z.string().optional(),
  description: z.string().max(500).optional(),
  recipientAddress: stellarAddress.optional(),
});

// ── Pagination (moved from validations.ts) ────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Opaque keyset cursor from a previous response's meta.nextCursor. */
  cursor: z.string().min(1).optional(),
  status: z.string().optional(),
  search: z.string().optional(),
});

export type PaginationParams = z.infer<typeof paginationSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;

// ── Recurrence alias ───────────────────────────────────────────

/** Alias of createRecurringSchema kept for callers using the older name. */
export const createRecurrenceSchema = createRecurringSchema;

// ── Refund Schemas ────────────────────────────────────────────

export const requestRefundSchema = z.object({
  paymentId: z.number().int().positive(),
  amount: z.number().positive(),
  asset: z.string().min(1),
  reason: z.string().max(500),
  reasonCode: z.number().int().min(0).max(5),
});

/**
 * Persists a refund ledger row after a successful on-chain request_refund.
 * onChainId is the contract's u64 refund id, captured from the tx return value.
 */
export const createRefundRecordSchema = requestRefundSchema.extend({
  onChainId: z.number().int().positive().optional(),
});

export const updateRefundStatusSchema = z.object({
  status: z.enum(["APPROVED", "PROCESSED", "REJECTED"]),
});

// ── Hook Schemas ──────────────────────────────────────────────

/**
 * Persists a notification hook row after a successful on-chain register_hook.
 * onChainId is the contract's u64 hook id, captured from the tx return value.
 */
export const createHookSchema = z.object({
  eventType: z.string().min(1).max(100),
  webhookUrl: z.string().url("Invalid webhook URL"),
  onChainId: z.number().int().positive().optional(),
});

export const updateHookSchema = z.object({
  active: z.boolean(),
});

// ─── Generic validation helper ────────────────────────────────

/**
 * Parses and validates JSON request body against a Zod schema.
 * Returns the parsed data or a Response with validation errors.
 */
export async function validateBody<T>(
  request: Request,
  schema: z.ZodSchema<T>,
): Promise<{ success: true; data: T } | { success: false; response: Response }> {
  const body = await request.json().catch(() => null);

  if (body === null) {
    return {
      success: false,
      response: Response.json(
        { success: false, error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
        { status: 400 },
      ),
    };
  }

  const result = schema.safeParse(body);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    return {
      success: false,
      response: Response.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Validation failed", errors } },
        { status: 400 },
      ),
    };
  }

  return { success: true, data: result.data };
}
