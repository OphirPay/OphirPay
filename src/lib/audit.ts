// SPDX-License-Identifier: MIT

/**
 * Audit trail utility — records important actions for security and compliance.
 * In production, write to a dedicated audit log table or external service.
 */

export interface AuditEntry {
  action: string;
  actor?: string;
  target?: string;
  details?: Record<string, unknown>;
  timestamp: string;
  ip?: string;
}

const inMemoryAuditLog: AuditEntry[] = [];
let auditListeners: Array<(entry: AuditEntry) => void> = [];

/**
 * Register a listener for recorded audit events (useful for real-time streaming or testing).
 */
export function addAuditListener(listener: (entry: AuditEntry) => void): () => void {
  auditListeners.push(listener);
  return () => {
    auditListeners = auditListeners.filter((l) => l !== listener);
  };
}

/**
 * Retrieve recorded audit entries from the in-memory buffer.
 */
export function getAuditLogs(): AuditEntry[] {
  return [...inMemoryAuditLog];
}

/**
 * Clear the in-memory audit log buffer.
 */
export function clearAuditLogs(): void {
  inMemoryAuditLog.length = 0;
}

/**
 * Record an audit event. Logs to console in development and notifies registered listeners.
 * In production, this can also write to a persistent store or external audit service.
 */
export function recordAudit(entry: Omit<AuditEntry, "timestamp">): AuditEntry {
  const audit: AuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  inMemoryAuditLog.push(audit);
  for (const listener of auditListeners) {
    try {
      listener(audit);
    } catch {
      // Non-blocking listener failure
    }
  }

  if (process.env.NODE_ENV === "development") {
    console.log(`[Audit] ${entry.action}`, audit);
  }

  return audit;
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
