// SPDX-License-Identifier: MIT
// AUTO-GENERATED FILE (docs/ERROR_CODES.md). DO NOT EDIT THE DOC BY HAND.
// Run `npm run generate-error-docs` to update it.

/**
 * Builds `docs/ERROR_CODES.md` — the single table mapping every error code
 * reachable from the API/lib layer to its HTTP status, meaning, trigger
 * condition and retryability (issue #778) — directly from the taxonomy in
 * `src/lib/error-codes.ts`, the Soroban contract catalog in
 * `src/lib/contract-errors.ts`, and the Horizon map in `src/lib/stellar-error.ts`.
 *
 * Generating (rather than hand-writing) the table is what lets a test assert
 * the doc can never drift from the taxonomy: `src/__tests__/error-codes-doc.test.ts`
 * regenerates this content and compares it byte-for-byte against the checked-in file.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ERROR_TAXONOMY, type ErrorDefinition } from "@/lib/error-codes";
import { getContractErrorCatalog } from "@/lib/contract-errors";
import { HORIZON_ERROR_MESSAGES, isRecoverableStellarError } from "@/lib/stellar-error";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docPath = path.join(__dirname, "../docs/ERROR_CODES.md");

/**
 * Trigger-condition rules, most specific first. Matched against the code
 * name so the doc's "Trigger condition" column stays in sync automatically
 * as codes are added — no per-code hand-authored text to go stale.
 */
const TRIGGER_RULES: [RegExp, string][] = [
  [/^RATE_LIMIT/, "Caller exceeded the allowed request rate for this scope."],
  [/^(MISSING_|API_KEY_MISSING|TOKEN_MISSING)/, "A required field, header, or credential was omitted from the request."],
  [/_REQUIRED$/, "A required field or precondition was not supplied."],
  [/(^INVALID_|_INVALID$|_MALFORMED$|^MALFORMED_|_INVALID_FORMAT$)/, "Supplied input failed format or schema validation."],
  [/(_TOO_SMALL$|_BELOW_MINIMUM$|TOO_LOW$|_NOT_MET$)/, "A numeric value or condition fell below the required minimum."],
  [/(_TOO_LARGE$|_EXCEEDS_MAXIMUM$|_TOO_LONG$|_EXCEEDED$|_LIMIT_EXCEEDED$)/, "A value, payload, or count exceeded the allowed maximum."],
  [/(^EXPIRED_|_EXPIRED$)/, "A time-bound resource, token, or window passed its expiry before being used."],
  [/^ALREADY_|_ALREADY_/, "The requested action was already performed and cannot be repeated."],
  [/_NOT_FOUND$/, "Lookup of the resource by its identifier returned no match."],
  [/_EXISTS$/, "A create/register operation targeted an identifier that is already in use."],
  [/_CANCELLED$/, "The resource was previously cancelled and can no longer be acted on."],
  [/(_COMPLETED$|_RESOLVED$|_EXECUTED$)/, "The resource has already reached a terminal state."],
  [/_PAUSED$/, "The resource is currently paused and rejects this operation."],
  [/_LOCKED$/, "The resource is locked and cannot be modified right now."],
  [/(_DISABLED$|_SUSPENDED$)/, "The account or feature has been administratively disabled."],
  [/^NOT_(OWNER|SIGNER|MEMBER|APPROVER|ADMIN|ACCEPTABLE)$/, "Caller does not hold the role or relationship required for this action."],
  [/^INSUFFICIENT_/, "The account does not have enough balance, reserve, or permission for this operation."],
  [/^(TOKEN_|SESSION_|API_KEY_|EXPIRED_API_KEY)/, "Credential or session validation failed for the supplied token, key, or session."],
  [/_TIMEOUT$/, "An upstream call did not complete within the allotted time."],
  [/_UNAVAILABLE$/, "A required dependency was unreachable or degraded."],
  [/^(CONTRACT_|RPC_|SOROBAN_|HORIZON_|STELLAR_)/, "A Soroban/Stellar network call failed or returned an unexpected result."],
  [/^(DATABASE_|DB_|CACHE_)/, "A data-layer operation (query, transaction, or cache access) failed."],
  [/^WEBHOOK_/, "Webhook registration or delivery failed."],
  [/^(CSV_|EXPORT_|IMPORT_)/, "Bulk import/export data failed validation or processing."],
  [/^BATCH_/, "A batch operation could not proceed in its current state."],
  [/^ESCROW_/, "The escrow is not in a state that allows this operation."],
  [/^STREAM_/, "The payment stream is not in a state that allows this operation."],
  [/^(PROPOSAL_|VOTING_|QUORUM_|INSUFFICIENT_VOTING_POWER)/, "Governance proposal or voting rules were not satisfied."],
  [/^(SIGNER_|THRESHOLD_|MULTISIG_)/, "Multisig configuration or signer-threshold rules were not satisfied."],
  [/^WALLET_/, "The connected wallet rejected or could not complete the requested action."],
  [/^PAYMENT_/, "The payment is not in a state that allows this operation."],
  [/^TRANSACTION_/, "The Stellar transaction failed, expired, or was rejected."],
  [/(^CONFLICT$|_CONFLICT$)/, "The request conflicts with the resource's current state."],
  [/^SELF_PAYMENT$/, "The source and destination address are the same account."],
  [/(^FOREIGN_KEY$|^RELATION_VIOLATION$)/, "The operation violates a database relational constraint."],
  [/(^REGION_RESTRICTED$|^LEGALLY_RESTRICTED$)/, "The action is blocked for this jurisdiction or legal reason."],
  [/(^UNAUTHORIZED$|^INVALID_CREDENTIALS$)/, "The request lacked valid authentication credentials."],
  [/(^FORBIDDEN$|^INSUFFICIENT_(PERMISSIONS|SCOPE)$|^ROLE_REQUIRED$)/, "The caller is authenticated but lacks permission for this action."],
  [/^MAINTENANCE_MODE$/, "The service is in scheduled maintenance mode."],
  [/^FEATURE_NOT_ENABLED$/, "The requested feature is disabled by configuration or feature flag."],
  [/^METHOD_NOT_ALLOWED$/, "The HTTP method is not supported on this route."],
  [/^ROUTE_NOT_FOUND$/, "No route matches the requested path."],
  [/^(UNSUPPORTED_MEDIA_TYPE|UNSUPPORTED_ENCODING)$/, "The request's content type or encoding is not supported."],
  [/^(UNPROCESSABLE_ENTITY|BUSINESS_RULE_VIOLATION)$/, "The request was well-formed but violates a business rule."],
  [/^(RESOURCE_DELETED|CONTRACT_DEPRECATED)$/, "The resource was permanently removed or superseded."],
  [/^(UNKNOWN_ERROR|INTERNAL_ERROR)$/, "An unclassified server-side failure occurred."],
  [/^(BAD_REQUEST|VALIDATION_ERROR|INVALID_INPUT)$/, "The request body or parameters did not pass validation."],
  [/^NOT_FOUND$/, "The requested resource does not exist."],
];

function triggerCondition(code: string): string {
  for (const [pattern, text] of TRIGGER_RULES) {
    if (pattern.test(code)) return text;
  }
  return "Application-specific condition — see Description.";
}

function titleCase(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function apiTableRow(def: ErrorDefinition): string {
  return `| \`${def.code}\` | ${titleCase(def.code)} | ${def.status} | ${def.message} | ${triggerCondition(def.code)} | ${def.retryable ? "Retryable" : "Terminal"} |`;
}

export function generateErrorCodesDoc(): string {
  const entries = Object.values(ERROR_TAXONOMY).sort((a, b) => a.status - b.status || a.code.localeCompare(b.code));
  const retryableCount = entries.filter((e) => e.retryable).length;

  const contractEntries = getContractErrorCatalog();
  const horizonKeys = Object.keys(HORIZON_ERROR_MESSAGES);

  let out = `# API Error Code Reference

<!-- AUTO-GENERATED FILE. DO NOT EDIT BY HAND. Run \`npm run generate-error-docs\` to update. -->

This is the single reference table for every error code the OphirPay API and
shared \`src/lib\` layer can return — the code-to-HTTP-status mapping
requested in issue #778. It is generated from the taxonomy in
[\`src/lib/error-codes.ts\`](../src/lib/error-codes.ts) by
[\`scripts/generate-error-docs.ts\`](../scripts/generate-error-docs.ts), so it
cannot drift: [\`src/__tests__/error-codes-doc.test.ts\`](../src/__tests__/error-codes-doc.test.ts)
regenerates this file and fails the build if the checked-in copy differs —
run \`npm run generate-error-docs\` whenever a code is added, removed, or
reclassified.

## How this maps to the code

- **\`src/lib/error-codes.ts\`** owns the taxonomy below: each code's HTTP
  \`status\`, default \`message\`, and now \`retryable\` flag are derived from
  the single \`CODES_BY_STATUS\` table (issue #760) plus the fixed
  \`RETRYABLE_STATUSES\` set.
- **\`src/lib/api-response.ts\`** is the only place that serializes the
  \`{ success: false, error: { code, message, details }, timestamp }\`
  envelope (via \`errorEnvelope()\`); every helper and route funnels through it.
- **\`src/lib/error-messages.ts\`** and **\`src/lib/stellar-error.ts\`** classify
  upstream Soroban/Horizon failures into this same taxonomy rather than
  returning ad-hoc strings.
- **\`src/lib/contract-errors.ts\`** mirrors the on-chain \`PaymentError\` enum
  (\`contracts/ophirpay/src/lib.rs\`) and is auto-generated by
  \`npm run generate-errors\`; every decoded contract failure surfaces to API
  clients as the single taxonomy code \`CONTRACT_ERROR\` (HTTP 500).

## Retryable vs. terminal

A code is **Retryable** when the failure is transient — a request timeout,
rate limit, or infra/server fault — and the client may safely retry the same
request (honoring \`Retry-After\` where the response sets it). Every other
code is **Terminal**: retrying the identical request will fail the same way
again, and the client must change something (input, credentials, target
resource, or wait for a different condition) before trying again.

Retryability is derived from the HTTP status group, not hand-picked per code:
statuses ${Array.from(new Set(entries.map((e) => e.status))).filter((s) => s === 408 || s === 429 || s === 500 || s === 503).join(", ")}
are retryable; all other statuses are terminal. See \`RETRYABLE_STATUSES\` in
\`src/lib/error-codes.ts\`.

## API & library error codes (${entries.length} codes, ${retryableCount} retryable)

| Code | Name | HTTP Status | Description | Trigger Condition | Retryable |
|---|---|---|---|---|---|
`;

  for (const def of entries) {
    out += apiTableRow(def) + "\n";
  }

  out += `
## Soroban contract error codes (${contractEntries.length} codes)

\`PaymentError\` variants from \`contracts/ophirpay/src/lib.rs\`, decoded by
[\`src/lib/contract-errors.ts\`](../src/lib/contract-errors.ts)
(\`CONTRACT_ERROR_MAP\`, auto-generated — see
\`npm run generate-errors\`). \`decodeContractError()\` turns a raw
\`Error(Contract, #N)\` diagnostic into the message below; that message is
then wrapped, via \`classifyContractError()\` in
[\`src/lib/error-messages.ts\`](../src/lib/error-messages.ts), into the
single taxonomy code **\`CONTRACT_ERROR\`** (HTTP 500, terminal by default —
see the table above). For per-variant Rust doc comments and the mirrored
\`EmitterError\` catalog, see
[\`docs/CONTRACT_FUNCTION_REFERENCE.md\`](CONTRACT_FUNCTION_REFERENCE.md).

| Numeric Code | Decoded Message | Surfaces As |
|---|---|---|
`;

  for (const { code, message } of contractEntries) {
    out += `| \`${code}\` | ${message} | \`CONTRACT_ERROR\` (500) |\n`;
  }

  out += `
## Stellar Horizon result codes (${horizonKeys.length} codes)

Horizon transaction/operation result codes, mapped to user-friendly text by
[\`src/lib/stellar-error.ts\`](../src/lib/stellar-error.ts)
(\`HORIZON_ERROR_MESSAGES\`). \`classifyStellarError()\` wraps the message into
the taxonomy code **\`HORIZON_ERROR\`** (HTTP 500). Retryable here reflects
\`isRecoverableStellarError()\` — Horizon codes describing a condition the
caller can fix and resubmit (underfunded, reserve, sequence, expired,
insufficient) are marked retryable even though the wrapping \`HORIZON_ERROR\`
taxonomy entry defaults to terminal.

| Result Code | Description | Surfaces As | Retryable |
|---|---|---|---|
`;

  for (const key of horizonKeys) {
    const message = HORIZON_ERROR_MESSAGES[key]!;
    out += `| \`${key}\` | ${message} | \`HORIZON_ERROR\` (500) | ${isRecoverableStellarError(message) ? "Retryable" : "Terminal"} |\n`;
  }

  return out;
}

if (process.argv[1] === __filename) {
  const output = generateErrorCodesDoc();
  fs.writeFileSync(docPath, output);
  console.log(`Successfully regenerated ${path.relative(process.cwd(), docPath)}`);
}
