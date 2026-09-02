// SPDX-License-Identifier: MIT

/**
 * In-app notification center & browser notification utility for payment events.
 * Manages event normalization, session-scoped persistence, live SSE/WS updates,
 * and browser notification alerts.
 */

import { STORAGE_KEYS } from "./storage-keys";
import { shortenAddress, formatAmount } from "./utils";
import { XLM_STROOPS } from "./stellar";

// ── Notification Types ──────────────────────────────────────────

export type PaymentEventType =
  | "payment.sent"
  | "payment.received"
  | "payment.batch_completed"
  | "payment.created"
  | "payment.failed";

export interface PaymentNotification {
  id: string;
  type: PaymentEventType;
  title: string;
  message: string;
  timestamp: number; // Unix timestamp in milliseconds
  read: boolean;
  amount?: string;
  symbol?: string;
  payer?: string;
  payee?: string;
  counterparty?: string;
  txHash?: string;
  batchId?: string;
  recipientCount?: number;
  status?: "COMPLETED" | "PENDING" | "FAILED" | "CANCELLED";
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RawPaymentEventPayload {
  id?: string | number;
  paymentId?: string;
  event?: string;
  type?: string;
  timestamp?: string | number;
  payer?: string;
  payee?: string;
  amount?: string | number;
  amountStroops?: number;
  amountXlm?: number;
  txHash?: string;
  tx_hash?: string;
  batchId?: string;
  recipients?: number;
  recipientCount?: number;
  status?: string;
  emitter?: string;
  read?: boolean;
  metadata?: string | Record<string, unknown>;
  title?: string;
  message?: string;
  counterparty?: string;
  [key: string]: unknown;
}

// ── Initial Seed Data (for new sessions) ─────────────────────────

export const INITIAL_NOTIFICATIONS: PaymentNotification[] = [
  {
    id: "notif_seed_1",
    type: "payment.received",
    title: "Payment Received",
    message: "Received 150.00 XLM from GCAL...8K2P",
    timestamp: Date.now() - 5 * 60 * 1000,
    read: false,
    amount: "150.00 XLM",
    symbol: "XLM",
    counterparty: "GCALXQMKV3XOMWBKLY2C7Q6RN2P2VY3NXN3T8K2P",
    payer: "GCALXQMKV3XOMWBKLY2C7Q6RN2P2VY3NXN3T8K2P",
    txHash: "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
    status: "COMPLETED",
  },
  {
    id: "notif_seed_2",
    type: "payment.sent",
    title: "Payment Sent",
    message: "Sent 45.50 XLM to GDQM...9Y1Z",
    timestamp: Date.now() - 25 * 60 * 1000,
    read: false,
    amount: "45.50 XLM",
    symbol: "XLM",
    counterparty: "GDQMXQZKV4XOMWBKLY2C7Q6RN2P2VY3NXN3T9Y1Z",
    payee: "GDQMXQZKV4XOMWBKLY2C7Q6RN2P2VY3NXN3T9Y1Z",
    txHash: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    status: "COMPLETED",
  },
  {
    id: "notif_seed_3",
    type: "payment.batch_completed",
    title: "Batch Payment Complete",
    message: "Successfully processed payroll batch to 8 recipients",
    timestamp: Date.now() - 2 * 60 * 60 * 1000,
    read: true,
    amount: "1,200.00 XLM",
    symbol: "XLM",
    recipientCount: 8,
    batchId: "batch_0921a",
    status: "COMPLETED",
  },
];

// ── Event Normalization ──────────────────────────────────────────

/**
 * Formats an amount value (string, number, or stroops) into a display string.
 */
function formatEventAmount(rawAmount?: string | number, amountStroops?: number, amountXlm?: number): string | undefined {
  if (amountXlm !== undefined && !isNaN(amountXlm)) {
    return formatAmount(amountXlm, "XLM");
  }
  if (amountStroops !== undefined && !isNaN(amountStroops)) {
    return formatAmount(amountStroops / XLM_STROOPS, "XLM");
  }
  if (rawAmount !== undefined && rawAmount !== null) {
    if (typeof rawAmount === "number") {
      return rawAmount > 10000
        ? formatAmount(rawAmount / XLM_STROOPS, "XLM")
        : formatAmount(rawAmount, "XLM");
    }
    const str = String(rawAmount).trim();
    if (/^\d+(\.\d+)?$/.test(str)) {
      const num = parseFloat(str);
      return num > 100000
        ? formatAmount(num / XLM_STROOPS, "XLM")
        : formatAmount(num, "XLM");
    }
    return str;
  }
  return undefined;
}

/**
 * Normalizes any raw event payload into a standard PaymentNotification.
 */
export function normalizePaymentEvent(raw: RawPaymentEventPayload): PaymentNotification {
  const rawType = (raw.type || raw.event || "").toLowerCase().replace(":", ".");
  let type: PaymentEventType = "payment.created";

  if (rawType.includes("sent")) {
    type = "payment.sent";
  } else if (rawType.includes("received")) {
    type = "payment.received";
  } else if (rawType.includes("batch")) {
    type = "payment.batch_completed";
  } else if (rawType.includes("failed")) {
    type = "payment.failed";
  } else {
    type = "payment.created";
  }

  const txHash = raw.txHash || raw.tx_hash || undefined;
  const id = raw.id
    ? String(raw.id)
    : raw.paymentId || (txHash ? `evt_${txHash.slice(0, 12)}` : `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

  let timestamp = Date.now();
  if (typeof raw.timestamp === "number") {
    timestamp = raw.timestamp < 1e12 ? raw.timestamp * 1000 : raw.timestamp;
  } else if (typeof raw.timestamp === "string") {
    const parsed = new Date(raw.timestamp).getTime();
    if (!isNaN(parsed)) {
      timestamp = parsed;
    }
  }

  const amount = formatEventAmount(raw.amount, raw.amountStroops, raw.amountXlm);
  const recipientCount = raw.recipientCount ?? raw.recipients;
  const payer = raw.payer;
  const payee = raw.payee;
  const counterparty = raw.counterparty || (type === "payment.sent" ? payee : payer);

  let title = raw.title;
  let message = raw.message;

  if (!title) {
    switch (type) {
      case "payment.sent":
        title = amount ? `Payment Sent: ${amount}` : "Payment Sent";
        break;
      case "payment.received":
        title = amount ? `Payment Received: ${amount}` : "Payment Received";
        break;
      case "payment.batch_completed":
        title = "Batch Payment Complete";
        break;
      case "payment.failed":
        title = "Payment Failed";
        break;
      case "payment.created":
      default:
        title = "Payment Recorded";
        break;
    }
  }

  if (!message) {
    switch (type) {
      case "payment.sent":
        message = payee
          ? `Sent ${amount || "payment"} to ${shortenAddress(payee, 4)}`
          : `Sent ${amount || "payment"} on Stellar`;
        break;
      case "payment.received":
        message = payer
          ? `Received ${amount || "payment"} from ${shortenAddress(payer, 4)}`
          : `Received ${amount || "payment"} on Stellar`;
        break;
      case "payment.batch_completed":
        message = recipientCount
          ? `Successfully processed payments to ${recipientCount} recipients.`
          : `Successfully completed batch payment.`;
        break;
      case "payment.failed":
        message = `Payment transaction failed to execute.`;
        break;
      case "payment.created":
      default:
        message = payee
          ? `Payment of ${amount || "funds"} recorded to ${shortenAddress(payee, 4)}`
          : `New payment recorded on-chain`;
        break;
    }
  }

  return {
    id,
    type,
    title,
    message,
    timestamp,
    read: Boolean(raw.read),
    amount,
    symbol: "XLM",
    payer,
    payee,
    counterparty,
    txHash,
    batchId: raw.batchId,
    recipientCount,
    status: (raw.status as PaymentNotification["status"]) || "COMPLETED",
    metadata: typeof raw.metadata === "object" && raw.metadata !== null ? (raw.metadata as Record<string, unknown>) : undefined,
  };
}

// ── Session Storage Persistence ──────────────────────────────────

/**
 * Safely retrieves persisted notifications from sessionStorage.
 */
export function getStoredNotifications(): PaymentNotification[] {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return INITIAL_NOTIFICATIONS;
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    if (!raw) {
      window.sessionStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(INITIAL_NOTIFICATIONS));
      return INITIAL_NOTIFICATIONS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return INITIAL_NOTIFICATIONS;
  } catch {
    return INITIAL_NOTIFICATIONS;
  }
}

/**
 * Saves notifications list to sessionStorage.
 */
export function saveStoredNotifications(notifications: PaymentNotification[]): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;

  try {
    window.sessionStorage.setItem(
      STORAGE_KEYS.NOTIFICATIONS,
      JSON.stringify(notifications.slice(0, 50))
    );
  } catch {
    // Quota exceeded or storage disabled — fail silently
  }
}

/**
 * Calculates unread count from a list of notifications.
 */
export function getUnreadCount(notifications: PaymentNotification[]): number {
  return notifications.filter((n) => !n.read).length;
}

// ── Custom Event Dispatcher ──────────────────────────────────────

/**
 * Emits an in-app payment notification event across the window.
 * Also triggers browser notification if permitted.
 */
export function emitPaymentNotification(raw: RawPaymentEventPayload): PaymentNotification {
  const normalized = normalizePaymentEvent(raw);

  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent<PaymentNotification>("ophirpay:notification", {
          detail: normalized,
        })
      );
    } catch {
      // Ignore event dispatch errors
    }
  }

  // Also trigger browser notification
  sendNotification(normalized.title, {
    body: normalized.message,
    tag: normalized.type,
  });

  return normalized;
}

// ── Browser Notification API ─────────────────────────────────────

let permissionRequested = false;

export function isPermissionRequested(): boolean {
  return permissionRequested;
}

/**
 * Request browser notification permission.
 * Call this once during onboarding or after a user action.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;

  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  permissionRequested = true;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/**
 * Send a browser notification.
 * Only works after permission is granted.
 */
export function sendNotification(title: string, options?: NotificationOptions): void {
  if (typeof Notification === "undefined") return;

  if (Notification.permission === "granted") {
    new Notification(title, {
      icon: "/icon.svg",
      badge: "/icon.svg",
      ...options,
    });
  }
}

/**
 * Preconfigured notification templates.
 * Emits both in-app notification and browser notification.
 */
export const NOTIFY = {
  paymentSent: (amount: string, txHash: string, payee?: string) => {
    emitPaymentNotification({
      type: "payment.sent",
      amount,
      txHash,
      payee,
      title: `Payment Sent: ${amount}`,
      message: `Transaction ${txHash.slice(0, 10)}... confirmed on Stellar`,
    });
  },
  paymentReceived: (amount: string, from: string, txHash?: string) => {
    emitPaymentNotification({
      type: "payment.received",
      amount,
      payer: from,
      txHash,
      title: `Payment Received: ${amount}`,
      message: `From ${shortenAddress(from, 6)}...`,
    });
  },
  batchComplete: (recipients: number, batchId?: string, amount?: string) => {
    emitPaymentNotification({
      type: "payment.batch_completed",
      recipientCount: recipients,
      batchId,
      amount,
      title: "Batch Payment Complete",
      message: `Successfully sent payments to ${recipients} recipients.`,
    });
  },
};

