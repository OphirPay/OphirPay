// SPDX-License-Identifier: MIT

/**
 * Audit trail utility — records important actions for security and compliance.
 * In production, write to a dedicated audit log table or external service.
 */

interface AuditEntry {
  action: string;
  actor?: string;
  target?: string;
  details?: Record<string, unknown>;
  timestamp: string;
  ip?: string;
}

/**
 * Record an audit event. In development, logs to console.
 * In production, this should write to a database or external audit service.
 */
export function recordAudit(entry: Omit<AuditEntry, "timestamp">): void {
  const audit: AuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  if (process.env.NODE_ENV === "development") {
    console.log(`[Audit] ${entry.action}`, audit);
    return;
  }

  // Production: store in database
  // await prisma.auditLog.create({ data: audit });
}

/**
 * Common audit action types.
 */
export const AUDIT_ACTIONS = {
  WALLET_CONNECT: "wallet:connect",
  WALLET_DISCONNECT: "wallet:disconnect",
  PAYMENT_SEND: "payment:send",
  PAYMENT_RECEIVE: "payment:receive",
  BATCH_CREATE: "batch:create",
  BATCH_SUBMIT: "batch:submit",
  API_KEY_CREATE: "api_key:create",
  API_KEY_REVOKE: "api_key:revoke",
  WEBHOOK_CREATE: "webhook:create",
  WEBHOOK_DELETE: "webhook:delete",
  SETTINGS_CHANGE: "settings:change",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
