// SPDX-License-Identifier: MIT

/**
 * Notifications library.
 *
 * Provides:
 *  - Browser notification API wrappers (existing).
 *  - In-app notification type system and factories.
 *  - Display formatting helpers for notification dropdown UI.
 */

// ---------------------------------------------------------------------------
// Browser notification API (existing)
// ---------------------------------------------------------------------------

type Permission = "default" | "granted" | "denied";

export function getNotificationPermission(): Permission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  return Notification.permission as Permission;
}

export async function requestNotificationPermission(): Promise<Permission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  const result = await Notification.requestPermission();
  return result as Permission;
}

export function showBrowserNotification(title: string, options?: NotificationOptions): void {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }
  try {
    new Notification(title, options);
  } catch {
    // Some browsers throw if the document is not visible.
  }
}

// ---------------------------------------------------------------------------
// In-app notification system (new — GitHub Issue #49)
// ---------------------------------------------------------------------------

export type NotificationType =
  | "payment:sent"
  | "payment:received"
  | "batch:completed"
  | "payment:created";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string; // ISO
  read: boolean;
  amount?: string;
  txHash?: string;
}

export interface CreateNotificationData {
  amount?: string;
  from?: string;
  to?: string;
  txHash?: string;
  recipients?: number;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create a new AppNotification object from a typed event.
 * The returned notification is always unread (read=false).
 */
export function createNotification(
  type: NotificationType,
  data: CreateNotificationData
): AppNotification {
  const base: AppNotification = {
    id: randomId(),
    type,
    title: "",
    message: "",
    timestamp: new Date().toISOString(),
    read: false,
    amount: data.amount,
    txHash: data.txHash,
  };

  base.title = formatNotificationTitle(base);
  base.message = formatNotificationMessage(base, data);

  return base;
}

export function formatNotificationTitle(n: AppNotification): string {
  switch (n.type) {
    case "payment:sent":
      return "Payment sent";
    case "payment:received":
      return "Payment received";
    case "batch:completed":
      return "Batch completed";
    case "payment:created":
      return "Payment created";
    default:
      return "Notification";
  }
}

export function formatNotificationMessage(
  n: AppNotification,
  data?: CreateNotificationData
): string {
  const d = data ?? { from: undefined, to: undefined, recipients: undefined };
  switch (n.type) {
    case "payment:sent":
      if (n.amount && d.to) {
        return `${n.amount} sent to ${shortAddr(d.to)}`;
      }
      return n.amount ? `${n.amount} sent` : "A payment was sent";
    case "payment:received":
      if (n.amount && d.from) {
        return `${n.amount} received from ${shortAddr(d.from)}`;
      }
      return n.amount ? `${n.amount} received` : "A payment was received";
    case "batch:completed":
      if (n.amount && d.recipients) {
        return `${n.amount} to ${d.recipients} recipients`;
      }
      return d.recipients ? `Sent to ${d.recipients} recipients` : "Batch transfer completed";
    case "payment:created": {
      const payerName = d.from ? shortAddr(d.from) : "unknown";
      const amountStr = n.amount ?? "—";
      return `${amountStr} from ${payerName}`;
    }
    default:
      return "";
  }
}

function shortAddr(addr: string, chars = 6): string {
  if (!addr) return "";
  if (addr.length <= chars * 2 + 1) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

const MAX_NOTIFICATIONS = 20;

export function appendNotification(
  list: AppNotification[],
  n: AppNotification
): AppNotification[] {
  return [n, ...list].slice(0, MAX_NOTIFICATIONS);
}
