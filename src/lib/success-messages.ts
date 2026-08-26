// SPDX-License-Identifier: MIT

/**
 * User-facing success and confirmation message catalog.
 */

export const SUCCESS_MESSAGES = {
  PAYMENT_SENT: (amount: string) => `Payment of ${amount} sent successfully!`,
  BATCH_SENT: (count: number) => `Batch payment to ${count} recipients sent successfully!`,
  WALLET_CONNECTED: "Wallet connected successfully.",
  WEBHOOK_CREATED: "Webhook created. Save the secret — it won't be shown again.",
  API_KEY_CREATED: "API key created. Copy it now — it won't be shown again.",
  SETTINGS_SAVED: "Settings saved successfully.",
  PAYMENT_REQUEST_CREATED: "Payment request created and ready to share.",
  RECURRENCE_CREATED: "Recurring payment schedule created.",
  ADDRESS_SAVED: "Address saved to your address book.",
  CSV_EXPORTED: "Data exported to CSV successfully.",
} as const;
