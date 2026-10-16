// SPDX-License-Identifier: MIT

/**
 * SEP-0007 URI generator and parser for Stellar payments.
 * Specification: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md#operation-pay
 */

export type Sep7MemoType = "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";

export interface Sep7PayParams {
  /** The Stellar address (G...) or federated address of the recipient. */
  destination: string;
  /** Amount to transfer. */
  amount?: string | number;
  /** Asset code (e.g. XLM, USDC). If omitted or XLM, assetIssuer is omitted. */
  assetCode?: string;
  /** Account ID of the asset issuer (required if assetCode is not XLM/native). */
  assetIssuer?: string;
  /** Memo content. */
  memo?: string;
  /** Memo type: MEMO_TEXT, MEMO_ID, MEMO_HASH, or MEMO_RETURN. */
  memoType?: Sep7MemoType;
  /** Human-readable explanation of why the payment is needed. */
  msg?: string;
  /** Network passphrase if targeting a specific network (e.g. Testnet vs Public). */
  networkPassphrase?: string;
  /** Domain of the service originating the request. */
  originDomain?: string;
}

/**
 * Generates a SEP-0007 compliant `web+stellar:pay` URI.
 * Validated for mobile wallets (Lobstr, Vibrant, Freighter, etc.).
 */
export function generateSep7PayUri(params: Sep7PayParams): string {
  if (!params.destination || !params.destination.trim()) {
    throw new Error("Destination address is required for SEP-0007 payment URI");
  }

  const queryParts: string[] = [];

  // destination (required)
  queryParts.push(`destination=${encodeURIComponent(params.destination.trim())}`);

  // amount (optional)
  if (params.amount !== undefined && params.amount !== null && String(params.amount).trim() !== "") {
    const amtStr = String(params.amount).trim();
    const num = parseFloat(amtStr);
    if (!isNaN(num) && num > 0) {
      queryParts.push(`amount=${encodeURIComponent(amtStr)}`);
    }
  }

  // asset_code & asset_issuer (optional; omit if XLM or empty)
  const code = params.assetCode?.trim().toUpperCase();
  if (code && code !== "XLM" && code !== "NATIVE") {
    queryParts.push(`asset_code=${encodeURIComponent(code)}`);
    if (params.assetIssuer && params.assetIssuer.trim()) {
      queryParts.push(`asset_issuer=${encodeURIComponent(params.assetIssuer.trim())}`);
    }
  }

  // memo & memo_type (optional)
  if (params.memo && params.memo.trim()) {
    queryParts.push(`memo=${encodeURIComponent(params.memo.trim())}`);
    if (params.memoType) {
      queryParts.push(`memo_type=${encodeURIComponent(params.memoType)}`);
    } else {
      queryParts.push(`memo_type=MEMO_TEXT`);
    }
  }

  // msg (optional)
  if (params.msg && params.msg.trim()) {
    queryParts.push(`msg=${encodeURIComponent(params.msg.trim())}`);
  }

  // network_passphrase (optional)
  if (params.networkPassphrase && params.networkPassphrase.trim()) {
    queryParts.push(`network_passphrase=${encodeURIComponent(params.networkPassphrase.trim())}`);
  }

  // origin_domain (optional)
  if (params.originDomain && params.originDomain.trim()) {
    queryParts.push(`origin_domain=${encodeURIComponent(params.originDomain.trim())}`);
  }

  return `web+stellar:pay?${queryParts.join("&")}`;
}

/** Alias for generateSep7PayUri */
export const buildSep7PayUri = generateSep7PayUri;

/**
 * Builds a simple receive payload URI for a Stellar address using SEP-0007.
 */
export function buildReceivePayload(address: string): string {
  return generateSep7PayUri({ destination: address });
}

/**
 * Parses a SEP-0007 `web+stellar:pay` URI back into Sep7PayParams.
 * Returns null if the URI is malformed or missing the destination parameter.
 */
export function parseSep7PayUri(uri: string): Sep7PayParams | null {
  if (!uri || typeof uri !== "string") return null;

  const prefix = "web+stellar:pay?";
  if (!uri.startsWith(prefix)) return null;

  try {
    const queryString = uri.slice(prefix.length);
    const searchParams = new URLSearchParams(queryString);

    const destination = searchParams.get("destination");
    if (!destination) return null;

    const result: Sep7PayParams = { destination };

    const amount = searchParams.get("amount");
    if (amount) result.amount = amount;

    const assetCode = searchParams.get("asset_code");
    if (assetCode) result.assetCode = assetCode;

    const assetIssuer = searchParams.get("asset_issuer");
    if (assetIssuer) result.assetIssuer = assetIssuer;

    const memo = searchParams.get("memo");
    if (memo) result.memo = memo;

    const memoType = searchParams.get("memo_type");
    if (
      memoType === "MEMO_TEXT" ||
      memoType === "MEMO_ID" ||
      memoType === "MEMO_HASH" ||
      memoType === "MEMO_RETURN"
    ) {
      result.memoType = memoType;
    }

    const msg = searchParams.get("msg");
    if (msg) result.msg = msg;

    const networkPassphrase = searchParams.get("network_passphrase");
    if (networkPassphrase) result.networkPassphrase = networkPassphrase;

    const originDomain = searchParams.get("origin_domain");
    if (originDomain) result.originDomain = originDomain;

    return result;
  } catch {
    return null;
  }
}
