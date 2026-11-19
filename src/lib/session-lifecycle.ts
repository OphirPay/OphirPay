// SPDX-License-Identifier: MIT

/**
 * Client-side session-lifecycle coordination (issue #1379).
 *
 * Disconnecting a wallet must do more than clear the header state. On a shared
 * machine, leaving any of the following behind lets the *next* wallet read the
 * previous account's data or lose work:
 *
 *   1. the server-side HTTP-only session cookie — revoked by `revokeSession()`
 *      (`@/lib/client-auth`), which the wallet hook calls on disconnect;
 *   2. React Query's in-memory cache of balances/transactions — purged by the
 *      `QueryProvider`, which subscribes to {@link onSessionRevoked}; and
 *   3. unsaved drafts / in-flight transactions — surfaced by the pending-work
 *      registry below so the disconnect dialog can warn the user first.
 *
 * Both pieces are module-level stores (not React state) so any component can
 * read them without prop-drilling, and so `hasPendingWork()` is answerable
 * synchronously from an event handler.
 */

export interface PendingWork {
  /** Forms holding unsubmitted input (e.g. a batch that has not been paid). */
  unsavedDrafts: number;
  /** Transactions currently being built/signed/submitted. */
  inFlightTransactions: number;
}

const EMPTY_WORK: PendingWork = { unsavedDrafts: 0, inFlightTransactions: 0 };

let work: PendingWork = { ...EMPTY_WORK };
const workListeners = new Set<(work: PendingWork) => void>();

function emitWork(): void {
  for (const listener of workListeners) listener(work);
}

/**
 * Merge a partial update into the pending-work snapshot. Counts are clamped at
 * zero so a double "remove" cannot drive them negative and permanently
 * suppress the warning.
 */
export function setPendingWork(next: Partial<PendingWork>): void {
  work = {
    unsavedDrafts: Math.max(0, next.unsavedDrafts ?? work.unsavedDrafts),
    inFlightTransactions: Math.max(
      0,
      next.inFlightTransactions ?? work.inFlightTransactions
    ),
  };
  emitWork();
}

export function setUnsavedDrafts(count: number): void {
  setPendingWork({ unsavedDrafts: count });
}

export function setInFlightTransactions(count: number): void {
  setPendingWork({ inFlightTransactions: count });
}

export function getPendingWork(): PendingWork {
  return work;
}

/** True when a disconnect would discard drafts or orphan an in-flight tx. */
export function hasPendingWork(): boolean {
  return work.unsavedDrafts > 0 || work.inFlightTransactions > 0;
}

/** Reset the registry (wallet disconnect, or between tests). */
export function resetPendingWork(): void {
  work = { ...EMPTY_WORK };
  emitWork();
}

/** Subscribe to pending-work changes; returns an unsubscribe function. */
export function subscribePendingWork(
  listener: (work: PendingWork) => void
): () => void {
  workListeners.add(listener);
  return () => {
    workListeners.delete(listener);
  };
}

// ── Session revocation ─────────────────────────────────────────

const revokeListeners = new Set<() => void>();

/** Subscribe to session revocation; returns an unsubscribe function. */
export function onSessionRevoked(listener: () => void): () => void {
  revokeListeners.add(listener);
  return () => {
    revokeListeners.delete(listener);
  };
}

/**
 * Announce that the wallet session has ended. Subscribers (the QueryProvider)
 * purge every cached query so the account data cannot leak to the next wallet.
 * Never throws: a misbehaving listener must not abort the disconnect flow.
 */
export function notifySessionRevoked(): void {
  for (const listener of revokeListeners) {
    try {
      listener();
    } catch {
      // A failing cache purge must not break wallet teardown.
    }
  }
}
