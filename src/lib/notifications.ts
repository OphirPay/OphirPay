// SPDX-License-Identifier: MIT

/**
 * Browser notification API utility for payment alerts.
 * Requests permission once and sends notifications for important events.
 */

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
 */
export const NOTIFY = {
  paymentSent: (amount: string, txHash: string) => {
    sendNotification(`Payment Sent: ${amount}`, {
      body: `Transaction ${txHash.slice(0, 10)}... confirmed on Stellar`,
      tag: "payment-sent",
    });
  },
  paymentReceived: (amount: string, from: string) => {
    sendNotification(`Payment Received: ${amount}`, {
      body: `From ${from.slice(0, 10)}...`,
      tag: "payment-received",
    });
  },
  batchComplete: (recipients: number) => {
    sendNotification("Batch Payment Complete", {
      body: `Successfully sent payments to ${recipients} recipients.`,
      tag: "batch-complete",
    });
  },
};
