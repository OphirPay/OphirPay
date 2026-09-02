// SPDX-License-Identifier: MIT

import { z } from "zod";

// ── Address / Identifier Schemas ──────────────────────────────

export const stellarAddress = z
  .string()
  .regex(/^G[A-Z0-9]{55}$/, "Invalid Stellar address — must be 56 chars starting with G");

export const apiKeyId = z.string().min(1, "API key ID is required");

// ── Memo Field ────────────────────────────────────────────────
// Stellar MEMO_TEXT is limited to 28 UTF-8 *bytes* (not characters) and is
// expected to be plain printable text. Enforced server-side on every route
// that accepts a memo (payments, batches, multisig, updates) so invalid
// memos are rejected with a user-facing validation error before they reach
// persistence or transaction building.
//
// Charset: C0/C1 control characters (NUL, newlines, tabs, ESC, …) are
// rejected outright — they are never legitimate memo content and rejecting
// them keeps memos safe to render, log, and export.
const MEMO_CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/** Error messages shown to users when a memo fails validation. */
export const MEMO_ERROR_MESSAGES = {
  tooLong: "Memo must be 28 characters or fewer",
  tooManyBytes:
    "Memo must be 28 bytes or fewer (non-ASCII characters count more)",
  controlChars: "Memo must not contain control or invisible characters",
} as const;

/**
 * Shared optional memo field for every schema that accepts a memo.
 * Trims surrounding whitespace, then enforces the Stellar byte limit and a
 * printable-text charset.
 */
export const memoField = z
  .string()
  .trim()
  .refine((v) => !MEMO_CONTROL_CHARS.test(v), {
    message: MEMO_ERROR_MESSAGES.controlChars,
  })
  .refine((v) => v.length <= 28, {
    message: MEMO_ERROR_MESSAGES.tooLong,
  })
  .refine((v) => new TextEncoder().encode(v).length <= 28, {
    message: MEMO_ERROR_MESSAGES.tooManyBytes,
  })
  .optional();

// ── Payment Schemas ───────────────────────────────────────────

export const createPaymentSchema = z.object({
  amount: z.number().positive("Amount must be greater than zero"),
  sourceAccountId: z.string().min(1, "Source account is required"),
  destAddress: stellarAddress,
  assetCode: z.string().default("XLM"),
  assetIssuer: z.string().optional(),
  description: z.string().max(200).optional(),
  memo: memoField,
});

/** Body for POST /api/payments/retry — which failed payment to retry. */
export const retryPaymentSchema = z.object({
  id: z.string().min(1, "Payment id is required"),
});

// All statuses the PATCH route can transition a payment through (the webhook
// dispatcher reacts to SIGNED / SUBMITTED / CONFIRMED / COMPLETED / FAILED).
export const paymentUpdateStatusValues = [
  "CREATED",
  "SIGNED",
  "SUBMITTED",
  "CONFIRMED",
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export const updatePaymentSchema = z.object({
  status: z.enum(paymentUpdateStatusValues).optional(),
  description: z.string().max(500).optional(),
  memo: memoField,
});

// Keep in sync with the PaymentStatus enum in prisma/schema.prisma.
const paymentStatusValues = [
  "CREATED",
  "SIGNED",
  "SUBMITTED",
  "CONFIRMED",
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

/** Status filter accepted by the payment CSV export endpoint. */
export const paymentStatusSchema = z.enum(paymentStatusValues);

/** Query params for GET /api/payments/export — same filters as the list route. */
export const paymentExportParamsSchema = z.object({
  status: paymentStatusSchema.optional(),
  search: z.string().optional(),
});

// ── Batch Schemas ─────────────────────────────────────────────

/**
 * Idempotency key shared by POST /api/batches (header or body field).
 *
 * The value is trimmed BEFORE validation so the validated value is exactly
 * the value that gets persisted — a body key like `"  short  "` is rejected
 * (its trimmed form is 5 chars) and `"  my-key-123  "` is stored as
 * `"my-key-123"`, keeping header and body keys consistent.
 */
export const idempotencyKeySchema = z
  .string("Idempotency key must be a string")
  .trim()
  .min(8, "Idempotency key must be at least 8 characters")
  .max(255, "Idempotency key must be at most 255 characters");

export const batchRecipientSchema = z.object({
  address: stellarAddress,
  amount: z.number().positive("Amount must be greater than zero"),
  assetCode: z.string().default("XLM"),
  memo: memoField,
});

/**
 * Idempotency key used to deduplicate batch submissions (issue #170).
 * Accepts either the `Idempotency-Key` header or an optional `idempotencyKey`
 * body field. `.trim()` runs before the length checks so a wrapped key is
 * normalized consistently and a whitespace-only value is rejected.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, "Idempotency key must be at least 8 characters")
  .max(255, "Idempotency key must be at most 255 characters");

export const createBatchSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  recipients: z.array(batchRecipientSchema).min(1).max(100),
  sourceAccountId: z.string().min(1),
  idempotencyKey: idempotencyKeySchema.optional(),
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
  memo: memoField,
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
  events: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

export const webhookReplaySchema = z.object({
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const webhookDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
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

export const paymentStatuses = [
  "CREATED",
  "PENDING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export const paymentStatusSchema = z.enum(paymentStatuses);

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

// ── Scheduled Payment Schemas ──────────────────────────────────

export const createScheduledPaymentSchema = z.object({
  amount: z.number().positive("Amount must be greater than 0"),
  assetCode: z.string().default("XLM"),
  assetIssuer: z.string().optional(),
  destAddress: stellarAddress,
  memo: z.string().max(28).optional(),
  scheduledFor: z
    .string()
    .refine(
      (value) => !Number.isNaN(new Date(value).getTime()),
      "Scheduled date must be a valid date"
    )
    .refine(
      (value) => new Date(value).getTime() > Date.now(),
      "Scheduled date must be in the future"
    ),
});

export type CreateScheduledPaymentInput = z.infer<typeof createScheduledPaymentSchema>;

// ── Recurrence alias ───────────────────────────────────────────

/** Alias of createRecurringSchema kept for callers using the older name. */
export const createRecurrenceSchema = createRecurringSchema;

// ── Refund Schemas ────────────────────────────────────────────

/**
 * Coded refund reasons (0–5), shared by the analytics bucketing in
 * GET /api/refunds?analytics=true and the POST validation below.
 */
export const REFUND_REASON_CODES = [0, 1, 2, 3, 4, 5] as const;
export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];

export const requestRefundSchema = z.object({
  paymentId: z.number().int().positive(),
  amount: z.number().positive(),
  asset: z.string().min(1),
  reason: z.string().max(500),
  reasonCode: z
    .number()
    .int()
    .refine((v) => (REFUND_REASON_CODES as readonly number[]).includes(v), {
      message: "reasonCode must be one of the supported codes: 0-5",
    }),
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
