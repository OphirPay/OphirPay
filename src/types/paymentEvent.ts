/**
 * Minimal type definition for a PaymentEvent emitted by OphirPay.
 *
 * The real project already defines a richer type; this file exists to
 * provide a compile‑time reference for the new adapters and tests without
 * pulling in the full contract‑generated types.
 */
export interface PaymentEvent {
  /** Unique identifier of the payment */
  id: string;
  /** Human‑readable amount (already formatted) */
  amount: string;
  /** Currency code, e.g. "USD" */
  currency: string;
  /** Status string such as "succeeded", "failed", "pending" */
  status: string;
  /** ISO‑8601 timestamp of when the payment was created */
  createdAt: string;
  /** Optional on‑chain transaction hash */
  transactionHash?: string;
  /** Optional free‑form metadata supplied by the sender */
  metadata?: Record<string, unknown>;
}
