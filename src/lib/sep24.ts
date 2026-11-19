// SPDX-License-Identifier: MIT

/**
 * SEP-24 interactive deposit / withdrawal client (issue #821).
 *
 * Stellar's standard fiat on/off-ramp is an *anchor* implementing SEP-24: the
 * app discovers the anchor's endpoints from its SEP-1 `stellar.toml`, asks the
 * anchor to start an interactive session, opens the returned URL for the user
 * (KYC happens **there**, at the anchor), then polls the transaction endpoint
 * until it reaches a terminal state.
 *
 * Nothing about the anchor is hardcoded — the domain is configuration
 * (`NEXT_PUBLIC_ANCHOR_DOMAIN`) and every endpoint comes from the fetched
 * TOML. This module holds no keys and moves no fiat: it is a client of the
 * anchor, and the anchor is the regulated party.
 *
 * The transport is injected (`fetchImpl` / `resolveToml`) so the flow can be
 * exercised end-to-end against a fake anchor without network access.
 */

import { StellarToml } from "@stellar/stellar-sdk";

// ── Configuration ──────────────────────────────────────────────

/** Default testnet anchor used when `NEXT_PUBLIC_ANCHOR_DOMAIN` is unset. */
export const DEFAULT_ANCHOR_DOMAIN = "testanchor.stellar.org";

/** Default fiat currency shown/entered for the anchor. */
export const DEFAULT_ANCHOR_FIAT_CURRENCY = "USD";

export function getAnchorDomain(): string {
  const raw = process.env.NEXT_PUBLIC_ANCHOR_DOMAIN?.trim();
  return raw && raw !== "" ? raw.replace(/^https?:\/\//, "").replace(/\/+$/, "") : DEFAULT_ANCHOR_DOMAIN;
}

export function getAnchorFiatCurrency(): string {
  const raw = process.env.NEXT_PUBLIC_ANCHOR_FIAT_CURRENCY?.trim();
  return raw && raw !== "" ? raw.toUpperCase() : DEFAULT_ANCHOR_FIAT_CURRENCY;
}

function readPositiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getAnchorMetadataTtlMs(): number {
  return readPositiveInt("ANCHOR_METADATA_TTL_MS", 5 * 60 * 1000);
}
export function getAnchorPollIntervalMs(): number {
  return readPositiveInt("ANCHOR_POLL_INTERVAL_MS", 5_000);
}
export function getAnchorPollTimeoutMs(): number {
  return readPositiveInt("ANCHOR_POLL_TIMEOUT_MS", 10 * 60 * 1000);
}

// ── Types ──────────────────────────────────────────────────────

/** A `[[CURRENCIES]]` entry from the anchor's TOML. */
export interface AnchorCurrency {
  code?: string;
  issuer?: string;
  name?: string;
  desc?: string;
  image?: string;
  anchor_asset_type?: string;
}

/** The subset of a parsed anchor `stellar.toml` we depend on. */
export interface AnchorToml {
  NETWORK_PASSPHRASE?: string;
  TRANSFER_SERVER_SEP0024?: string;
  TRANSFER_SERVER?: string;
  WEB_AUTH_ENDPOINT?: string;
  SIGNING_KEY?: string;
  CURRENCIES?: AnchorCurrency[];
}

/** Endpoints + metadata discovered from the anchor's TOML. */
export interface AnchorMetadata {
  domain: string;
  /** SEP-24 transfer server base URL. */
  transferServer: string;
  webAuthEndpoint: string | null;
  networkPassphrase: string | null;
  currencies: AnchorCurrency[];
  /** True when served from the in-process cache. */
  cached: boolean;
}

export type AnchorFlowKind = "deposit" | "withdrawal";

/** The interactive session returned by the anchor. */
export interface InteractiveFlow {
  /** Interactive URL to open (new window/iframe, per the anchor's needs). */
  url: string;
  /** SEP-24 transaction id, used for polling. */
  id: string;
  kind: AnchorFlowKind;
}

/** SEP-24 transaction statuses. */
export type Sep24Status =
  | "incomplete"
  | "pending_user_transfer_start"
  | "pending_user_transfer_complete"
  | "pending_anchor"
  | "pending_stellar"
  | "pending_trust"
  | "pending_user"
  | "completed"
  | "refunded"
  | "expired"
  | "error"
  | "no_market"
  | "too_small"
  | "too_large";

/** A SEP-24 transaction record (subset). */
export interface AnchorTransaction {
  id: string;
  kind?: AnchorFlowKind;
  status: Sep24Status;
  /** Amount delivered to/from the user's Stellar account. */
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  message?: string;
  more_info_url?: string;
}

/** The app-facing state a poll result maps to. */
export type AnchorFlowState = "pending" | "completed" | "refunded" | "failed";

/** Terminal SEP-24 statuses that end polling. */
export const TERMINAL_STATUSES: readonly Sep24Status[] = [
  "completed",
  "refunded",
  "expired",
  "error",
  "no_market",
  "too_small",
  "too_large",
];

export function isTerminalStatus(status: Sep24Status): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Map a SEP-24 status onto the app's flow-state vocabulary. */
export function mapAnchorStatus(status: Sep24Status): AnchorFlowState {
  switch (status) {
    case "completed":
      return "completed";
    case "refunded":
      return "refunded";
    case "expired":
    case "error":
    case "no_market":
    case "too_small":
    case "too_large":
      return "failed";
    default:
      return "pending";
  }
}

/** A fetch-like function (injected in tests). */
export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface Sep24Dependencies {
  fetchImpl?: FetchLike;
  resolveToml?: (domain: string) => Promise<AnchorToml>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

// ── Errors ─────────────────────────────────────────────────────

/** Raised when the anchor returns a SEP-24 error body. */
export class AnchorError extends Error {
  readonly code = "ANCHOR_ERROR";
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AnchorError";
    this.status = status;
  }
}

/** Raised when polling exceeds its budget. */
export class AnchorPollTimeoutError extends Error {
  readonly code = "ANCHOR_POLL_TIMEOUT";
  constructor(timeoutMs: number) {
    super(`Anchor transaction did not reach a terminal state within ${timeoutMs}ms`);
    this.name = "AnchorPollTimeoutError";
  }
}

// ── Metadata discovery + cache ─────────────────────────────────

interface MetadataCacheEntry {
  metadata: AnchorMetadata;
  at: number;
}

const metadataCache = new Map<string, MetadataCacheEntry>();

/** Clear caches between tests. */
export function resetAnchorCache(): void {
  metadataCache.clear();
}

async function defaultResolveToml(domain: string): Promise<AnchorToml> {
  return (await StellarToml.Resolver.resolve(domain, {
    allowHttp: false,
  })) as unknown as AnchorToml;
}

/**
 * Discover the anchor's SEP-24 endpoints from its SEP-1 `stellar.toml`.
 *
 * Cached per domain for `ANCHOR_METADATA_TTL_MS`. Throws `AnchorError` when
 * the TOML is unreachable or declares no transfer server — the caller must
 * not silently fall back to a hardcoded anchor.
 */
export async function fetchAnchorMetadata(
  domain: string = getAnchorDomain(),
  deps: Sep24Dependencies = {}
): Promise<AnchorMetadata> {
  const resolveToml = deps.resolveToml ?? defaultResolveToml;
  const now = deps.now?.() ?? Date.now();

  const cached = metadataCache.get(domain);
  if (cached && now - cached.at < getAnchorMetadataTtlMs()) {
    return { ...cached.metadata, cached: true };
  }

  let toml: AnchorToml;
  try {
    toml = await resolveToml(domain);
  } catch (err) {
    throw new AnchorError(
      `Could not load the anchor's stellar.toml from ${domain}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // SEP-24 prefers TRANSFER_SERVER_SEP0024; TRANSFER_SERVER is the legacy name.
  const transferServer = toml.TRANSFER_SERVER_SEP0024 ?? toml.TRANSFER_SERVER;
  if (!transferServer) {
    throw new AnchorError(
      `Anchor ${domain} does not advertise a SEP-24 transfer server`
    );
  }

  const metadata: AnchorMetadata = {
    domain,
    transferServer: transferServer.replace(/\/+$/, ""),
    webAuthEndpoint: toml.WEB_AUTH_ENDPOINT ?? null,
    networkPassphrase: toml.NETWORK_PASSPHRASE ?? null,
    currencies: Array.isArray(toml.CURRENCIES) ? toml.CURRENCIES : [],
    cached: false,
  };

  metadataCache.set(domain, { metadata, at: now });
  return metadata;
}

// ── Interactive flow ───────────────────────────────────────────

function formEncode(fields: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  }
  return params.toString();
}

async function parseAnchorError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    /* non-JSON error body */
  }
  return `Anchor responded with HTTP ${res.status}`;
}

/**
 * Start a SEP-24 interactive deposit or withdrawal session.
 *
 * POSTs form-encoded `asset_code`/`account` (+ optional `amount`, `memo`) to
 * the transfer server and returns the interactive URL plus the transaction id
 * to poll. `jwt` is the SEP-10 token when the anchor requires auth.
 */
export async function initiateInteractiveFlow(params: {
  kind: AnchorFlowKind;
  assetCode: string;
  account: string;
  amount?: string;
  memo?: string;
  jwt?: string;
  transferServer: string;
  fetchImpl?: FetchLike;
}): Promise<InteractiveFlow> {
  const { kind, assetCode, account, amount, memo, jwt, transferServer } = params;
  const fetchImpl = params.fetchImpl ?? (fetch as FetchLike);

  const body = formEncode({ asset_code: assetCode, account, amount, memo });
  const res = await fetchImpl(
    `${transferServer.replace(/\/+$/, "")}/transactions/${kind}/interactive`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body,
    }
  );

  if (!res.ok) {
    throw new AnchorError(await parseAnchorError(res), res.status);
  }

  // SEP-24's `type` on this response is the *response* type
  // (`interactive_customer_info_needed`), not the flow kind — the kind is the
  // one the caller asked for.
  const json = (await res.json()) as { url?: string; id?: string };
  if (!json?.url || !json?.id) {
    throw new AnchorError("Anchor returned an incomplete interactive response");
  }

  return { url: json.url, id: json.id, kind };
}

/**
 * Fetch a SEP-24 transaction by id (GET `/transaction`).
 */
export async function fetchAnchorTransaction(params: {
  transferServer: string;
  id: string;
  jwt?: string;
  fetchImpl?: FetchLike;
}): Promise<AnchorTransaction> {
  const { transferServer, id, jwt } = params;
  const fetchImpl = params.fetchImpl ?? (fetch as FetchLike);

  const url = `${transferServer.replace(/\/+$/, "")}/transaction?${new URLSearchParams({ id }).toString()}`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
  });

  if (!res.ok) {
    throw new AnchorError(await parseAnchorError(res), res.status);
  }

  const json = (await res.json()) as { transaction?: AnchorTransaction };
  const transaction = json?.transaction;
  if (!transaction?.status) {
    throw new AnchorError("Anchor returned no transaction in the response");
  }
  return transaction;
}

/**
 * Poll a SEP-24 transaction until it reaches a terminal status.
 *
 * Resolves with the final transaction (its `status` maps through
 * `mapAnchorStatus` to completed/refunded/failed). Rejects with
 * `AnchorPollTimeoutError` when the budget elapses first, and with
 * `AnchorError` when a poll itself fails.
 */
export async function pollAnchorTransaction(
  params: {
    transferServer: string;
    id: string;
    jwt?: string;
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    onUpdate?: (tx: AnchorTransaction) => void;
    fetchImpl?: FetchLike;
  },
  deps: Sep24Dependencies = {}
): Promise<AnchorTransaction> {
  const fetchImpl = deps.fetchImpl ?? params.fetchImpl;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;

  const intervalMs = params.intervalMs ?? getAnchorPollIntervalMs();
  const timeoutMs = params.timeoutMs ?? getAnchorPollTimeoutMs();
  const deadline = now() + timeoutMs;

  // Poll immediately, then on the interval until the deadline.
  for (;;) {
    if (params.signal?.aborted) throw new AnchorError("Anchor polling aborted");
    const tx = await fetchAnchorTransaction({
      transferServer: params.transferServer,
      id: params.id,
      jwt: params.jwt,
      fetchImpl,
    });
    params.onUpdate?.(tx);
    if (isTerminalStatus(tx.status)) return tx;

    if (now() + intervalMs >= deadline) {
      throw new AnchorPollTimeoutError(timeoutMs);
    }
    await sleep(intervalMs);
  }
}
