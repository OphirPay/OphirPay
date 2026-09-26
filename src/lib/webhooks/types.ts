// SPDX-License-Identifier: MIT
//
// Shared webhook types.
//
// These are the wire types exchanged between the delivery pipeline stages
// (signing → delivery → persistence) and the request/response previews shown
// in the dashboard. Keeping them in one place lets `signing.ts`, `delivery.ts`
// and `persistence.ts` agree on the exact payload shape without importing each
// other's implementation.

/** The JSON envelope POSTed to a subscriber's endpoint. */
export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
  /** Present and true only for integrator test events — never real payments. */
  test?: boolean;
}

/** Result of a single delivery attempt sequence (one logical event). */
export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  latencyMs: number;
  attempts: number;
  errorMessage?: string;
}

/** The exact HTTP request a delivery would send, for dashboard previews. */
export interface WebhookRequestPreview {
  canonicalBody: string;
  body: string;
  signature: string;
  headers: Record<string, string>;
}

/** Rich per-attempt delivery outcome surfaced in the delivery-test UI. */
export interface WebhookDeliveryDetails extends WebhookDeliveryResult {
  delivered: boolean;
  status: number | null;
  responseBody: string;
  durationMs: number;
  blocked: boolean;
  error: string | null;
  request: WebhookRequestPreview;
}
