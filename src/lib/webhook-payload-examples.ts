// SPDX-License-Identifier: MIT

/**
 * Single source of truth for webhook payload documentation.
 *
 * The automation-platform guide (`docs/AUTOMATION_PLATFORMS.md`) and the
 * committed payload examples (`examples/webhook-payloads/*.json`) are
 * GENERATED from this module by `npm run generate:webhook-examples`, and
 * `src/__tests__/webhook-payload-examples.test.ts` fails if the committed
 * artifacts drift from it. When a payload field changes, change it here and
 * re-run the generator — never edit the generated doc tables or the JSON
 * example files by hand.
 *
 * Every event in `WEBHOOK_EVENTS` must have a contract entry below: a Zod
 * schema for the `data` object, field-level documentation, and a
 * deterministic example. Events whose emitters have not landed yet are
 * marked `emitted: false`; their contract is a documented preview.
 */

import { z } from "zod";
import {
  ALL_WEBHOOK_EVENTS,
  WEBHOOK_EVENTS,
  type WebhookEventType,
} from "@/app/api/webhooks/event-types";
import {
  WEBHOOK_TIMESTAMP_HEADER,
  buildSignedPayload,
  type WebhookPayload,
} from "@/lib/webhook-deliver";

/**
 * Well-known documentation secret — the same one used by
 * `docs/webhook-verification.md` and `examples/webhook-verification/`, so the
 * generated examples can be fed straight into the reference verifiers.
 */
export const WEBHOOK_EXAMPLE_SECRET = "test-secret-0123456789";

/** Realistic fixed values shared by the generated examples. */
const EXAMPLE_PAYMENT_ID = "cm5k9x2m00000356g4h7j8k2q";
const EXAMPLE_REQUEST_ID = "cm5ka1b2c00011356ddee1f2g";
const EXAMPLE_BATCH_ID = "cm5kb3c4d00022356ffg2h3i4";
const EXAMPLE_SCHEDULE_ID = "cm5kc5d6e00033356ggh4i5j6";
/** 64-char hex, shaped like a Stellar transaction hash. */
const EXAMPLE_TX_HASH =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
/** Mirrors `ON_CHAIN_FAILED_MESSAGE` in `src/lib/payment-sync.ts`. */
const EXAMPLE_ON_CHAIN_FAILURE =
  "Transaction failed on-chain. See the transaction on Stellar Expert for the operation result.";

/** ISO 8601 datetime string (what `Date.prototype.toISOString()` emits). */
const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Expected an ISO 8601 datetime string",
  });

/** Decimal string in asset units — Prisma `Decimal` serialized to JSON. */
const decimalAmount = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, "Expected a decimal string, e.g. \"125.50\"");

/** 64-char lowercase hex Stellar transaction hash. */
const txHash = z.string().regex(/^[0-9a-f]{64}$/, "Expected a 64-char hex hash");

const paymentBase = {
  paymentId: z.string().min(1),
  amount: decimalAmount,
  assetCode: z.string().min(1),
};

/** Schema for the full HTTP body OphirPay delivers (envelope + signature). */
export const webhookEnvelopeSchema = z.object({
  event: z.enum(ALL_WEBHOOK_EVENTS as [WebhookEventType, ...WebhookEventType[]]),
  timestamp: isoDateTime,
  data: z.record(z.string(), z.unknown()),
  /** Present and `true` only for integrator test events. */
  test: z.literal(true).optional(),
  /** HMAC-SHA256 hex — mirrors the `X-OphirPay-Signature` header. */
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});

export interface WebhookFieldDoc {
  name: string;
  type: string;
  description: string;
}

export interface WebhookEventContract {
  /** One-sentence "fired when" description for the docs. */
  summary: string;
  /** Whether production code dispatches this event today. */
  emitted: boolean;
  /** Source files that dispatch it (empty for reserved events). */
  emitters: string[];
  /** Lifecycle stage label used in the payload-examples section. */
  stage: string;
  /** Zod schema for the `data` object. */
  schema: z.ZodTypeAny;
  /** Field-level documentation, rendered into the docs table. */
  fields: WebhookFieldDoc[];
  /** Deterministic example `data` object. */
  exampleData: Record<string, unknown>;
  /** Fixed ISO timestamp used as the example's envelope `timestamp`. */
  exampleAt: string;
}

export const WEBHOOK_EVENT_CONTRACTS: Record<WebhookEventType, WebhookEventContract> = {
  [WEBHOOK_EVENTS.PAYMENT_CREATED]: {
    summary: "A payment was created via `POST /api/payments`.",
    emitted: true,
    emitters: ["src/app/api/payments/route.ts"],
    stage: "created",
    schema: z.object({
      ...paymentBase,
      status: z.string().min(1),
      createdAt: isoDateTime,
    }),
    fields: [
      { name: "paymentId", type: "string", description: "Application payment id (CUID) — use it to correlate later lifecycle events for the same payment." },
      { name: "amount", type: "string", description: "Amount in asset units as a decimal string (e.g. `\"125.50\"`), not stroops." },
      { name: "assetCode", type: "string", description: "Asset code sent, e.g. `\"XLM\"` or `\"USDC\"`." },
      { name: "status", type: "string", description: "Payment status at dispatch time — `\"CREATED\"` for this event." },
      { name: "createdAt", type: "string (ISO 8601)", description: "When the payment record was created." },
    ],
    exampleData: {
      paymentId: EXAMPLE_PAYMENT_ID,
      amount: "125.50",
      assetCode: "USDC",
      status: "CREATED",
      createdAt: "2026-01-15T12:00:00.000Z",
    },
    exampleAt: "2026-01-15T12:00:00.000Z",
  },

  [WEBHOOK_EVENTS.PAYMENT_SIGNED]: {
    summary: "The payer signed the payment transaction (status → `SIGNED`).",
    emitted: true,
    emitters: ["src/app/api/payments/[id]/route.ts"],
    stage: "signed",
    schema: z.object({
      ...paymentBase,
      status: z.string().min(1),
      signedAt: isoDateTime,
    }),
    fields: [
      { name: "paymentId", type: "string", description: "Application payment id (CUID)." },
      { name: "amount", type: "string", description: "Amount in asset units as a decimal string." },
      { name: "assetCode", type: "string", description: "Asset code sent." },
      { name: "status", type: "string", description: "Payment status at dispatch time — `\"SIGNED\"` for this event." },
      { name: "signedAt", type: "string (ISO 8601)", description: "When the signature was recorded." },
    ],
    exampleData: {
      paymentId: EXAMPLE_PAYMENT_ID,
      amount: "125.50",
      assetCode: "USDC",
      status: "SIGNED",
      signedAt: "2026-01-15T12:00:08.000Z",
    },
    exampleAt: "2026-01-15T12:00:08.000Z",
  },

  [WEBHOOK_EVENTS.PAYMENT_SUBMITTED]: {
    summary: "The signed transaction was submitted to the Stellar network (status → `SUBMITTED`).",
    emitted: true,
    emitters: ["src/app/api/payments/[id]/route.ts"],
    stage: "submitted",
    schema: z.object({
      ...paymentBase,
      transactionHash: txHash.nullable(),
      submittedAt: isoDateTime,
    }),
    fields: [
      { name: "paymentId", type: "string", description: "Application payment id (CUID)." },
      { name: "amount", type: "string", description: "Amount in asset units as a decimal string." },
      { name: "assetCode", type: "string", description: "Asset code sent." },
      { name: "transactionHash", type: "string | null", description: "64-char hex Stellar transaction hash — view it on Stellar Expert. `null` if unavailable." },
      { name: "submittedAt", type: "string (ISO 8601)", description: "When the transaction was submitted to the network." },
    ],
    exampleData: {
      paymentId: EXAMPLE_PAYMENT_ID,
      amount: "125.50",
      assetCode: "USDC",
      transactionHash: EXAMPLE_TX_HASH,
      submittedAt: "2026-01-15T12:00:11.000Z",
    },
    exampleAt: "2026-01-15T12:00:11.000Z",
  },

  [WEBHOOK_EVENTS.PAYMENT_CONFIRMED]: {
    summary: "The transaction was confirmed on-chain (status → `CONFIRMED`). Also fired by the background reconciliation job.",
    emitted: true,
    emitters: ["src/app/api/payments/[id]/route.ts", "src/lib/payment-sync.ts"],
    stage: "confirmed",
    schema: z.object({
      ...paymentBase,
      transactionHash: txHash.nullable(),
      confirmedAt: isoDateTime,
    }),
    fields: [
      { name: "paymentId", type: "string", description: "Application payment id (CUID)." },
      { name: "amount", type: "string", description: "Amount in asset units as a decimal string." },
      { name: "assetCode", type: "string", description: "Asset code sent." },
      { name: "transactionHash", type: "string | null", description: "64-char hex Stellar transaction hash of the confirmed transaction." },
      { name: "confirmedAt", type: "string (ISO 8601)", description: "When confirmation was recorded (by the API or the sync job)." },
    ],
    exampleData: {
      paymentId: EXAMPLE_PAYMENT_ID,
      amount: "125.50",
      assetCode: "USDC",
      transactionHash: EXAMPLE_TX_HASH,
      confirmedAt: "2026-01-15T12:00:26.000Z",
    },
    exampleAt: "2026-01-15T12:00:26.000Z",
  },

  [WEBHOOK_EVENTS.PAYMENT_COMPLETED]: {
    summary: "The payment reached its terminal `COMPLETED` state.",
    emitted: true,
    emitters: ["src/app/api/payments/[id]/route.ts"],
    stage: "completed",
    schema: z.object({
      ...paymentBase,
      transactionHash: txHash.nullable(),
      completedAt: isoDateTime,
    }),
    fields: [
      { name: "paymentId", type: "string", description: "Application payment id (CUID)." },
      { name: "amount", type: "string", description: "Amount in asset units as a decimal string." },
      { name: "assetCode", type: "string", description: "Asset code sent." },
      { name: "transactionHash", type: "string | null", description: "64-char hex Stellar transaction hash of the completed transaction." },
      { name: "completedAt", type: "string (ISO 8601)", description: "When the payment was marked complete." },
    ],
    exampleData: {
      paymentId: EXAMPLE_PAYMENT_ID,
      amount: "125.50",
      assetCode: "USDC",
      transactionHash: EXAMPLE_TX_HASH,
      completedAt: "2026-01-15T12:00:26.000Z",
    },
    exampleAt: "2026-01-15T12:00:26.000Z",
  },

  [WEBHOOK_EVENTS.PAYMENT_FAILED]: {
    summary: "The payment failed (status → `FAILED`) — see `data.errorMessage`. Also fired by the background reconciliation job.",
    emitted: true,
    emitters: ["src/app/api/payments/[id]/route.ts", "src/lib/payment-sync.ts"],
    stage: "failed",
    schema: z.object({
      ...paymentBase,
      transactionHash: txHash.nullable().optional(),
      errorMessage: z.string().nullable(),
      failedAt: isoDateTime,
    }),
    fields: [
      { name: "paymentId", type: "string", description: "Application payment id (CUID)." },
      { name: "amount", type: "string", description: "Amount in asset units as a decimal string." },
      { name: "assetCode", type: "string", description: "Asset code sent." },
      { name: "transactionHash", type: "string | null", description: "Present only when the failure came from an on-chain transaction (reconciliation job); omitted by the API status transition." },
      { name: "errorMessage", type: "string | null", description: "Human-readable failure reason." },
      { name: "failedAt", type: "string (ISO 8601)", description: "When the failure was recorded." },
    ],
    exampleData: {
      paymentId: EXAMPLE_PAYMENT_ID,
      amount: "125.50",
      assetCode: "USDC",
      transactionHash: EXAMPLE_TX_HASH,
      errorMessage: EXAMPLE_ON_CHAIN_FAILURE,
      failedAt: "2026-01-15T12:01:02.000Z",
    },
    exampleAt: "2026-01-15T12:01:02.000Z",
  },

  [WEBHOOK_EVENTS.REQUEST_CREATED]: {
    summary: "A payment request was created via `POST /api/requests`.",
    emitted: true,
    emitters: ["src/app/api/requests/route.ts"],
    stage: "request created",
    schema: z.object({
      requestId: z.string().min(1),
      amount: decimalAmount,
      assetCode: z.string().min(1),
      description: z.string().nullable(),
      status: z.string().min(1),
      createdAt: isoDateTime,
    }),
    fields: [
      { name: "requestId", type: "string", description: "Payment request id (CUID)." },
      { name: "amount", type: "string", description: "Requested amount in asset units as a decimal string." },
      { name: "assetCode", type: "string", description: "Asset code requested." },
      { name: "description", type: "string | null", description: "Free-text note explaining what the request is for." },
      { name: "status", type: "string", description: "Request status at dispatch time — `\"PENDING\"` for this event." },
      { name: "createdAt", type: "string (ISO 8601)", description: "When the request was created." },
    ],
    exampleData: {
      requestId: EXAMPLE_REQUEST_ID,
      amount: "40.00",
      assetCode: "USDC",
      description: "Invoice #1042 — design retainer",
      status: "PENDING",
      createdAt: "2026-01-15T09:30:00.000Z",
    },
    exampleAt: "2026-01-15T09:30:00.000Z",
  },

  // ── Reserved events: in the catalog, not yet dispatched by production code.
  // The contracts below are the documented preview; they are validated and
  // generated like every other event so subscribers can build against them.

  [WEBHOOK_EVENTS.BATCH_CREATED]: {
    summary: "A batch payment run was created.",
    emitted: false,
    emitters: [],
    stage: "batch created",
    schema: z.object({
      batchId: z.string().min(1),
      totalPayments: z.number().int().positive(),
      totalAmount: decimalAmount,
      assetCode: z.string().min(1),
      status: z.string().min(1),
      createdAt: isoDateTime,
    }),
    fields: [
      { name: "batchId", type: "string", description: "Batch id (CUID)." },
      { name: "totalPayments", type: "number", description: "Number of payments in the batch." },
      { name: "totalAmount", type: "string", description: "Sum of all payments in asset units as a decimal string." },
      { name: "assetCode", type: "string", description: "Asset code for the batch." },
      { name: "status", type: "string", description: "Batch status at dispatch time — `\"CREATED\"` for this event." },
      { name: "createdAt", type: "string (ISO 8601)", description: "When the batch was created." },
    ],
    exampleData: {
      batchId: EXAMPLE_BATCH_ID,
      totalPayments: 25,
      totalAmount: "1250.00",
      assetCode: "USDC",
      status: "CREATED",
      createdAt: "2026-01-15T13:00:00.000Z",
    },
    exampleAt: "2026-01-15T13:00:00.000Z",
  },

  [WEBHOOK_EVENTS.BATCH_COMPLETED]: {
    summary: "A batch payment run finished — check `succeeded`/`failed` for the per-payment outcome.",
    emitted: false,
    emitters: [],
    stage: "batch completed",
    schema: z.object({
      batchId: z.string().min(1),
      totalPayments: z.number().int().positive(),
      succeeded: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      completedAt: isoDateTime,
    }),
    fields: [
      { name: "batchId", type: "string", description: "Batch id (CUID)." },
      { name: "totalPayments", type: "number", description: "Number of payments in the batch." },
      { name: "succeeded", type: "number", description: "Payments that completed successfully." },
      { name: "failed", type: "number", description: "Payments that failed." },
      { name: "completedAt", type: "string (ISO 8601)", description: "When the batch finished." },
    ],
    exampleData: {
      batchId: EXAMPLE_BATCH_ID,
      totalPayments: 25,
      succeeded: 24,
      failed: 1,
      completedAt: "2026-01-15T13:04:37.000Z",
    },
    exampleAt: "2026-01-15T13:04:37.000Z",
  },

  [WEBHOOK_EVENTS.BATCH_FAILED]: {
    summary: "A batch payment run failed before completing.",
    emitted: false,
    emitters: [],
    stage: "batch failed",
    schema: z.object({
      batchId: z.string().min(1),
      errorMessage: z.string().nullable(),
      failedAt: isoDateTime,
    }),
    fields: [
      { name: "batchId", type: "string", description: "Batch id (CUID)." },
      { name: "errorMessage", type: "string | null", description: "Human-readable failure reason." },
      { name: "failedAt", type: "string (ISO 8601)", description: "When the batch failed." },
    ],
    exampleData: {
      batchId: EXAMPLE_BATCH_ID,
      errorMessage: "Batch processing halted: 3 payments failed validation.",
      failedAt: "2026-01-15T13:02:10.000Z",
    },
    exampleAt: "2026-01-15T13:02:10.000Z",
  },

  [WEBHOOK_EVENTS.RECURRENCE_TRIGGERED]: {
    summary: "A recurring payment schedule fired and created its next payment.",
    emitted: false,
    emitters: [],
    stage: "recurrence triggered",
    schema: z.object({
      scheduleId: z.string().min(1),
      paymentId: z.string().min(1),
      occurrence: z.number().int().positive(),
      triggeredAt: isoDateTime,
    }),
    fields: [
      { name: "scheduleId", type: "string", description: "Recurring schedule id (CUID)." },
      { name: "paymentId", type: "string", description: "Id of the payment created by this occurrence." },
      { name: "occurrence", type: "number", description: "1-based occurrence number within the schedule." },
      { name: "triggeredAt", type: "string (ISO 8601)", description: "When the schedule fired." },
    ],
    exampleData: {
      scheduleId: EXAMPLE_SCHEDULE_ID,
      paymentId: EXAMPLE_PAYMENT_ID,
      occurrence: 3,
      triggeredAt: "2026-01-15T14:00:00.000Z",
    },
    exampleAt: "2026-01-15T14:00:00.000Z",
  },

  [WEBHOOK_EVENTS.RECURRENCE_COMPLETED]: {
    summary: "A recurring payment schedule ran its final occurrence.",
    emitted: false,
    emitters: [],
    stage: "recurrence completed",
    schema: z.object({
      scheduleId: z.string().min(1),
      totalOccurrences: z.number().int().positive(),
      completedAt: isoDateTime,
    }),
    fields: [
      { name: "scheduleId", type: "string", description: "Recurring schedule id (CUID)." },
      { name: "totalOccurrences", type: "number", description: "Total number of occurrences the schedule produced." },
      { name: "completedAt", type: "string (ISO 8601)", description: "When the schedule completed." },
    ],
    exampleData: {
      scheduleId: EXAMPLE_SCHEDULE_ID,
      totalOccurrences: 12,
      completedAt: "2026-12-15T14:00:00.000Z",
    },
    exampleAt: "2026-12-15T14:00:00.000Z",
  },

  [WEBHOOK_EVENTS.RECURRENCE_FAILED]: {
    summary: "A recurring payment schedule occurrence failed.",
    emitted: false,
    emitters: [],
    stage: "recurrence failed",
    schema: z.object({
      scheduleId: z.string().min(1),
      errorMessage: z.string().nullable(),
      failedAt: isoDateTime,
    }),
    fields: [
      { name: "scheduleId", type: "string", description: "Recurring schedule id (CUID)." },
      { name: "errorMessage", type: "string | null", description: "Human-readable failure reason." },
      { name: "failedAt", type: "string (ISO 8601)", description: "When the occurrence failed." },
    ],
    exampleData: {
      scheduleId: EXAMPLE_SCHEDULE_ID,
      errorMessage: "Scheduled payment failed: insufficient balance.",
      failedAt: "2026-02-15T14:00:00.000Z",
    },
    exampleAt: "2026-02-15T14:00:00.000Z",
  },

  [WEBHOOK_EVENTS.REQUEST_PAID]: {
    summary: "A payment request was paid in full.",
    emitted: false,
    emitters: [],
    stage: "request paid",
    schema: z.object({
      requestId: z.string().min(1),
      paymentId: z.string().min(1),
      amount: decimalAmount,
      assetCode: z.string().min(1),
      paidAt: isoDateTime,
    }),
    fields: [
      { name: "requestId", type: "string", description: "Payment request id (CUID)." },
      { name: "paymentId", type: "string", description: "Id of the payment that settled the request." },
      { name: "amount", type: "string", description: "Paid amount in asset units as a decimal string." },
      { name: "assetCode", type: "string", description: "Asset code paid." },
      { name: "paidAt", type: "string (ISO 8601)", description: "When the request was marked paid." },
    ],
    exampleData: {
      requestId: EXAMPLE_REQUEST_ID,
      paymentId: EXAMPLE_PAYMENT_ID,
      amount: "40.00",
      assetCode: "USDC",
      paidAt: "2026-01-16T10:15:00.000Z",
    },
    exampleAt: "2026-01-16T10:15:00.000Z",
  },

  [WEBHOOK_EVENTS.REQUEST_EXPIRED]: {
    summary: "A payment request expired without being paid.",
    emitted: false,
    emitters: [],
    stage: "request expired",
    schema: z.object({
      requestId: z.string().min(1),
      expiredAt: isoDateTime,
    }),
    fields: [
      { name: "requestId", type: "string", description: "Payment request id (CUID)." },
      { name: "expiredAt", type: "string (ISO 8601)", description: "When the request expired." },
    ],
    exampleData: {
      requestId: EXAMPLE_REQUEST_ID,
      expiredAt: "2026-01-22T09:30:00.000Z",
    },
    exampleAt: "2026-01-22T09:30:00.000Z",
  },
};

/** Events shown as full payloads in the guide's lifecycle-examples section. */
export const DOCUMENTED_PAYLOAD_EXAMPLE_EVENTS: WebhookEventType[] = [
  WEBHOOK_EVENTS.PAYMENT_CREATED,
  WEBHOOK_EVENTS.PAYMENT_SIGNED,
  WEBHOOK_EVENTS.PAYMENT_SUBMITTED,
  WEBHOOK_EVENTS.PAYMENT_CONFIRMED,
  WEBHOOK_EVENTS.PAYMENT_COMPLETED,
  WEBHOOK_EVENTS.PAYMENT_FAILED,
  WEBHOOK_EVENTS.REQUEST_CREATED,
];

export interface WebhookPayloadExample {
  event: WebhookEventType;
  /** The exact headers OphirPay sends with the delivery. */
  headers: Record<string, string>;
  /** Full HTTP body as an object, including the computed `signature`. */
  body: Record<string, unknown>;
  /** Pretty-printed body (2-space indent), as committed under `examples/webhook-payloads/`. */
  bodyJson: string;
}

/**
 * Build a deterministic, fully-signed example delivery for an event. The
 * signature is computed with the real `buildSignedPayload` and the well-known
 * docs secret, so examples verify with the reference implementations.
 */
export function buildWebhookPayloadExample(event: WebhookEventType): WebhookPayloadExample {
  const contract = WEBHOOK_EVENT_CONTRACTS[event];
  if (!contract) throw new Error(`No webhook payload contract for event: ${event}`);

  const payload: WebhookPayload = {
    event,
    timestamp: contract.exampleAt,
    data: contract.exampleData,
  };
  const { body, signature, timestamp } = buildSignedPayload(payload, WEBHOOK_EXAMPLE_SECRET);
  const parsed = JSON.parse(body) as Record<string, unknown>;

  return {
    event,
    headers: {
      "Content-Type": "application/json",
      "X-OphirPay-Event": event,
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
      "X-OphirPay-Signature": signature,
    },
    body: parsed,
    bodyJson: JSON.stringify(parsed, null, 2),
  };
}

/** Deterministic examples for every event in the catalog. */
export const WEBHOOK_PAYLOAD_EXAMPLES: Record<WebhookEventType, WebhookPayloadExample> =
  Object.fromEntries(
    ALL_WEBHOOK_EVENTS.map((event) => [event, buildWebhookPayloadExample(event)]),
  ) as Record<WebhookEventType, WebhookPayloadExample>;

/** Example file path (repo-relative) for an event. */
export function webhookExampleFileName(event: WebhookEventType): string {
  return `examples/webhook-payloads/${event}.json`;
}

/** Sorted list of the `data` field names an event's schema accepts. */
export function webhookEventSchemaKeys(event: WebhookEventType): string[] {
  const schema = WEBHOOK_EVENT_CONTRACTS[event]?.schema;
  return schema instanceof z.ZodObject ? Object.keys(schema.shape).sort() : [];
}

/** Markers delimiting the generated sections of docs/AUTOMATION_PLATFORMS.md. */
export const GENERATED_MARKERS = {
  eventCatalog: {
    begin: "<!-- BEGIN GENERATED EVENT CATALOG -->",
    end: "<!-- END GENERATED EVENT CATALOG -->",
  },
  payloadExamples: {
    begin: "<!-- BEGIN GENERATED PAYLOAD EXAMPLES -->",
    end: "<!-- END GENERATED PAYLOAD EXAMPLES -->",
  },
} as const;

export type GeneratedSectionName = keyof typeof GENERATED_MARKERS;

/** Replace the content between a generated section's markers. */
export function replaceGeneratedSection(
  doc: string,
  section: GeneratedSectionName,
  content: string,
): string {
  const { begin, end } = GENERATED_MARKERS[section];
  const beginIndex = doc.indexOf(begin);
  const endIndex = doc.indexOf(end);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    throw new Error(`Generated section markers not found: ${begin} … ${end}`);
  }
  return `${doc.slice(0, beginIndex + begin.length)}\n\n${content}\n\n${doc.slice(endIndex)}`;
}

/** Render the per-event field tables for the guide. */
export function renderEventCatalogMarkdown(): string {
  // Escape pipes so union types ("string | null") don't split table columns.
  const cell = (value: string) => value.replace(/\|/g, "\\|");
  return ALL_WEBHOOK_EVENTS.map((event) => {
    const contract = WEBHOOK_EVENT_CONTRACTS[event];
    const statusNote = contract.emitted
      ? `_Emitted by ${contract.emitters.map((path) => `\`${path}\``).join(", ")}._`
      : "> ⏳ **Reserved — not emitted yet.** The shape below is the documented contract preview; fields may be adjusted when the emitters land.";
    const rows = contract.fields
      .map((field) => `| \`${field.name}\` | ${cell(field.type)} | ${cell(field.description)} |`)
      .join("\n");
    return [
      `### \`${event}\``,
      "",
      contract.summary,
      "",
      statusNote,
      "",
      "| `data` field | Type | Meaning |",
      "|---|---|---|",
      rows,
    ].join("\n");
  }).join("\n\n");
}

/** Render the full signed payload examples for the guide. */
export function renderPayloadExamplesMarkdown(): string {
  return DOCUMENTED_PAYLOAD_EXAMPLE_EVENTS.map((event) => {
    const contract = WEBHOOK_EVENT_CONTRACTS[event];
    const example = WEBHOOK_PAYLOAD_EXAMPLES[event];
    const headers = Object.entries(example.headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n");
    return [
      `#### Stage: ${contract.stage} — \`${event}\``,
      "",
      "```http",
      "POST /your-automation-endpoint HTTP/1.1",
      headers,
      "```",
      "",
      "```json",
      example.bodyJson,
      "```",
    ].join("\n");
  }).join("\n\n");
}
