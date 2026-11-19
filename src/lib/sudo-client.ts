// SPDX-License-Identifier: MIT

/**
 * Client-side sudo step-up helper (issue #1389).
 *
 * Critical admin routes (`POST /api/rbac`, `POST /api/fee-config`) answer
 * `403 SUDO_REQUIRED` with a fresh wallet challenge when the session's last
 * cryptographic verification is older than 15 minutes. {@link authorizeAdminAction}
 * makes that round-trip transparent: it POSTs the action, and on a step-up
 * challenge asks the caller to confirm (the re-auth modal), signs the challenge
 * with the connected wallet, and retries once with the proof — so admin pages
 * do not have to reimplement the protocol.
 *
 * The CSRF token is minted from `/api/csrf` and attached the same way
 * `useApiQuery`'s `apiFetch` does, because these are cookie-authenticated
 * browser mutations.
 */

export interface SudoChallengeDetails {
  challenge: string;
  message: string;
  expiresInSeconds: number;
}

/** The server demands step-up but the caller has no way to satisfy it. */
export class SudoRequiredError extends Error {
  readonly details: SudoChallengeDetails | null;
  constructor(message: string, details: SudoChallengeDetails | null) {
    super(message);
    this.name = "SudoRequiredError";
    this.details = details;
  }
}

/** The user dismissed the re-authentication prompt. */
export class SudoDeclinedError extends Error {
  constructor() {
    super("Re-authentication cancelled.");
    this.name = "SudoDeclinedError";
  }
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/csrf", { method: "GET" });
    if (!res.ok) return null;
    const json = (await res.json()) as { token?: string };
    return json.token ?? null;
  } catch {
    return null;
  }
}

async function postJson<T>(
  url: string,
  body: unknown
): Promise<{ status: number; envelope: ApiEnvelope<T> }> {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = await fetchCsrfToken();
  if (token) headers.set("x-csrf-token", token);

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const envelope = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: res.status, envelope };
}

export interface AuthorizeAdminActionOptions {
  /** Signs the server challenge. Omit when the wallet cannot sign messages. */
  signMessage?: (message: string) => Promise<string>;
  /**
   * Presents the challenge to the user (the re-auth modal) and resolves `true`
   * when they agree to re-authenticate. Defaults to approving immediately.
   */
  requestReauth?: (details: SudoChallengeDetails) => Promise<boolean>;
}

/**
 * Authorize a critical admin action, handling the sudo step-up round-trip.
 *
 * Resolves with the route's `data` payload (`{ authorized: true, … }`) when the
 * server accepts the action. Throws {@link SudoRequiredError} when step-up is
 * required but no `signMessage` is available, and {@link SudoDeclinedError}
 * when the user dismisses the prompt.
 */
export async function authorizeAdminAction<T = unknown>(
  url: string,
  body: Record<string, unknown>,
  options: AuthorizeAdminActionOptions = {}
): Promise<T> {
  const first = await postJson<T>(url, body);
  if (first.status >= 200 && first.status < 300) {
    return (first.envelope.data ?? (first.envelope as unknown)) as T;
  }

  if (first.status === 403 && first.envelope.error?.code === "SUDO_REQUIRED") {
    const details = (first.envelope.error.details ??
      null) as SudoChallengeDetails | null;
    if (!details || !options.signMessage) {
      throw new SudoRequiredError(
        first.envelope.error.message ?? "Re-authentication required.",
        details
      );
    }

    const approved = options.requestReauth
      ? await options.requestReauth(details)
      : true;
    if (!approved) throw new SudoDeclinedError();

    const signature = await options.signMessage(details.message);
    const second = await postJson<T>(url, {
      ...body,
      challenge: details.challenge,
      signature,
    });
    if (second.status >= 200 && second.status < 300) {
      return (second.envelope.data ?? (second.envelope as unknown)) as T;
    }
    throw new Error(
      second.envelope.error?.message ?? "Re-authentication failed."
    );
  }

  throw new Error(
    first.envelope.error?.message ?? `Request failed with status ${first.status}`
  );
}
