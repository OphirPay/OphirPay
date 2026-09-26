// SPDX-License-Identifier: MIT
//
// Generates docs/ERROR_CODES.md from src/lib/error-codes.ts, the same source
// the API uses at runtime. Hand-maintaining 200+ rows is how docs go stale, so
// the document is derived and a test fails when the two drift apart.
//
//   npm run generate-error-docs
//
// Retryability is *derived*, not declared. The codebase has no retryable flag
// on any code, so inventing one per row would be fiction that reads as
// authority. Instead a small explicit terminal set marks the codes that are
// never safe to replay, and everything else is classed by its HTTP status. That
// inversion is the point: a wrong "retryable" guess causes a duplicate payment,
// so the default has to be the safe side. See RETRY_TERMINAL below.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const codesPath = path.join(__dirname, "../src/lib/error-codes.ts");
const docPath = path.join(__dirname, "../docs/ERROR_CODES.md");

/**
 * Codes that must never be blindly retried, even though their status might
 * suggest it. Each entry is a deliberate, reviewable exception.
 *
 * The 409s here are the dangerous class: the request may already have taken
 * effect on-chain, so a naive retry can double-pay. 4xx validation codes are
 * excluded entirely because 400/422 is terminal by status.
 */
const RETRY_TERMINAL = new Set<string>([
  // 409 conflicts where a retry risks a duplicate on-chain effect
  "PAYMENT_ALREADY_PROCESSING",
  "PAYMENT_ALREADY_RECORDED",
  "IDEMPOTENCY_CONFLICT",
  "TRANSACTION_ALREADY_SUBMITTED",
  "DUPLICATE_PAYMENT",
  "ESCROW_ALREADY_RELEASED",
  "STREAM_ALREADY_CANCELLED",
  "ALREADY_EXECUTED",
  // 4xx that are not 400/422 and are still not replayable
  "SAME_ACCOUNT",
  "SELF_PAYMENT",
  "MEMO_REQUIRED",
  "UNSUPPORTED_ASSET",
  "ASSET_NOT_SUPPORTED",
  "CURRENCY_NOT_SUPPORTED",
  "MAINTENANCE_MODE",
  "FEATURE_NOT_ENABLED",
]);

/** True when replaying the same request can succeed and cannot double-apply. */
export function isRetryable(code: string, status: number): boolean {
  if (RETRY_TERMINAL.has(code)) return false;
  if (status === 429) return true;
  if (status === 408) return true;
  if (status === 503) return true;
  if (status >= 500) return true;
  return false;
}

interface Row {
  code: string;
  status: number;
  retryable: boolean;
}

export function parseCatalog(source: string): Row[] {
  const statusBlock = source.match(/export const ERROR_STATUS[\s\S]*?= \{([\s\S]*?)\n\};/);
  if (!statusBlock) {
    throw new Error(
      "ERROR_STATUS not found in src/lib/error-codes.ts — the catalog shape changed, update this generator."
    );
  }

  const rows: Row[] = [];
  const entry = /^\s*([A-Z0-9_]+):\s*(\d+)\s*,?\s*(\/\/.*)?$/gm;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(statusBlock[1])) !== null) {
    const code = m[1];
    const status = Number(m[2]);
    rows.push({ code, status, retryable: isRetryable(code, status) });
  }
  return rows;
}

const STATUS_NAMES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

const CATEGORY_INTRO: Record<number, string> = {
  400: "Input the caller can correct. Retrying unchanged will fail the same way.",
  401: "Credentials missing, expired or invalid. Obtain a new credential first.",
  403: "Authenticated but not permitted. Retrying does not help.",
  404: "The resource does not exist. Retrying does not help.",
  409: "State conflict. **Read the retryable column** — several of these may already have taken effect on-chain.",
  429: "Rate limited. Back off using `Retry-After`.",
  500: "Server-side fault. Generally safe to retry, except the rows marked terminal.",
  503: "Dependency unavailable. Retry with backoff.",
};

export function generateDoc(rows: Row[]): string {
  const byStatus = new Map<number, Row[]>();
  for (const r of rows) {
    if (!byStatus.has(r.status)) byStatus.set(r.status, []);
    byStatus.get(r.status)!.push(r);
  }

  const statuses = [...byStatus.keys()].sort((a, b) => a - b);
  const total = rows.length;
  const retryableCount = rows.filter((r) => r.retryable).length;

  const out: string[] = [];

  out.push("# Error codes");
  out.push("");
  out.push("<!-- AUTO-GENERATED from src/lib/error-codes.ts by scripts/generate-error-docs.ts.");
  out.push("     Do not edit by hand. Run `npm run generate-error-docs`. -->");
  out.push("");
  out.push(
    `Every code the API can return in \`{ success: false, error: { code, message } }\` — ${total} in total.`
  );
  out.push("");

  out.push("## How to use this table");
  out.push("");
  out.push(
    "Branch on `error.code`, not on the message text and not on the numeric value. Messages are user-facing and change; codes are the contract."
  );
  out.push("");
  out.push("```json");
  out.push("{");
  out.push('  "success": false,');
  out.push('  "error": {');
  out.push('    "code": "AMOUNT_BELOW_MINIMUM",');
  out.push('    "message": "Amount is below the configured minimum."');
  out.push("  }");
  out.push("}");
  out.push("```");
  out.push("");

  out.push("## Retrying");
  out.push("");
  out.push(
    `${retryableCount} of ${total} codes are classed retryable. Retry means *the same request, again* — with a fresh idempotency key if the endpoint has one.`
  );
  out.push("");
  out.push(
    "The class is **derived from the HTTP status**, then narrowed by an explicit terminal set in the generator. It is not hand-annotated per row, because a wrong `retryable` here costs a duplicate payment and a confident-looking table is how that happens."
  );
  out.push("");
  out.push("Retryable by status: `408`, `429`, `503` and `5xx` generally.");
  out.push("");
  out.push(
    "**The exceptions are the interesting part.** A `409` is not automatically safe to replay — if the payment already landed on Stellar, retrying double-pays. Those rows are listed as terminal in the generator's `RETRY_TERMINAL` set and must stay reviewed."
  );
  out.push("");
  out.push(
    "If you add a conflict code that can follow a partially-applied on-chain write, add it to `RETRY_TERMINAL` in `scripts/generate-error-docs.ts` in the same PR."
  );
  out.push("");

  out.push("## Codes");
  out.push("");

  for (const status of statuses) {
    const group = byStatus.get(status)!;
    const name = STATUS_NAMES[status] ?? "";
    out.push(`### ${status}${name ? ` — ${name}` : ""} (${group.length})`);
    out.push("");
    if (CATEGORY_INTRO[status]) {
      out.push(CATEGORY_INTRO[status]);
      out.push("");
    }
    out.push("| Code | Retryable |");
    out.push("| --- | --- |");
    for (const r of group.sort((a, b) => a.code.localeCompare(b.code))) {
      out.push(`| \`${r.code}\` | ${r.retryable ? "yes" : "no"} |`);
    }
    out.push("");
  }

  out.push("## Related");
  out.push("");
  out.push(
    "- [API_GUIDE.md](API_GUIDE.md) — the response envelope and the conventions every route follows"
  );
  out.push(
    "- `src/lib/error-codes.ts` — `ERROR_CODES` (the values) and `ERROR_STATUS` (the HTTP status for each)"
  );
  out.push(
    "- `src/lib/error-messages.ts` — user-facing strings. **Not** part of the contract; some are functions of arguments"
  );
  out.push(
    "- `src/lib/contract-errors.ts` — auto-generated from the Rust `PaymentError` enum, for decoding on-chain contract errors. Separate namespace from the codes above."
  );
  out.push("");

  return out.join("\n");
}

function main() {
  const source = fs.readFileSync(codesPath, "utf8");
  const rows = parseCatalog(source);
  if (rows.length === 0) {
    console.error("No codes parsed — refusing to write an empty table.");
    process.exit(1);
  }
  fs.writeFileSync(docPath, generateDoc(rows), "utf8");
  console.log(
    `Wrote docs/ERROR_CODES.md — ${rows.length} codes, ${
      rows.filter((r) => r.retryable).length
    } retryable.`
  );
}

if (process.argv[1] && process.argv[1].endsWith("generate-error-docs.ts")) {
  main();
}
