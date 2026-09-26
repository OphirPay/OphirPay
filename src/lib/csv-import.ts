// SPDX-License-Identifier: MIT

import type { BatchRecipient } from "@/types";
import { isValidStellarAddress } from "@/lib/stellar";

/**
 * Maximum recipients allowed in a single batch transaction (matches the
 * on-chain 100-operation limit used by `buildBatchPaymentTx`).
 */
export const MAX_BATCH_RECIPIENTS = 100;

/**
 * Maximum length of a payment memo in UTF-8 bytes (28), matching the
 * on-chain `memoField` rules enforced by the batch API.
 */
export const MEMO_MAX_BYTES = 28;

// ── CSV parsing ───────────────────────────────────────────────

/**
 * Parse CSV text into a matrix of cells. Handles quoted fields, escaped
 * quotes (`""` inside a quoted field), commas and newlines inside quotes,
 * and CRLF/CR line endings. A leading UTF-8 BOM is stripped, and rows that
 * are entirely blank are dropped.
 */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const clean = text.replace(/^\uFEFF/, "");
  let i = 0;

  while (i < clean.length) {
    const ch = clean[i];

    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r") {
      // CRLF or lone CR both end the row; swallow the LF if present.
      if (clean[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // Push the final row (input may not end with a newline).
  row.push(field);
  rows.push(row);

  // Drop rows that are entirely blank.
  return rows.filter((r) => r.some((cell) => cell !== ""));
}

// ── Field-level validation ────────────────────────────────────

export interface RecipientFieldErrors {
  address?: string;
  amount?: string;
  memo?: string;
}

/**
 * Validate a single recipient's fields. Returns an object keyed by field
 * name with a user-facing message; fields without errors are omitted.
 */
export function validateRecipientFields(
  address: string,
  amount: string,
  memo: string,
  opts: { selfAddress?: string | null } = {}
): RecipientFieldErrors {
  const errors: RecipientFieldErrors = {};

  const addr = address.trim();
  if (!addr) {
    errors.address = "Address is required.";
  } else if (!isValidStellarAddress(addr)) {
    errors.address = "Invalid Stellar address.";
  } else if (opts.selfAddress && addr === opts.selfAddress) {
    errors.address = "Cannot send to your own address.";
  }

  const amt = amount.trim();
  if (!amt) {
    errors.amount = "Amount is required.";
  } else {
    const n = parseFloat(amt);
    if (isNaN(n) || n <= 0) {
      errors.amount = "Amount must be a number greater than 0.";
    }
  }

  const mem = memo.trim();
  if (mem.length > 28) {
    errors.memo = "Memo must be 28 characters or fewer.";
  }

  return errors;
}

/**
 * Flag duplicate addresses across rows. Every occurrence of a duplicated
 * (valid) address after the first is marked with an address error. Rows that
 * already have an invalid-address error are left untouched.
 */
export function applyDuplicateErrors(rows: CsvImportRow[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const addr = row.values.address.trim();
    if (!addr || !isValidStellarAddress(addr)) continue;
    if (seen.has(addr)) {
      row.errors = { ...row.errors, address: "Duplicate address." };
    } else {
      seen.add(addr);
    }
  }
}

// ── Import rows for the preview UI ────────────────────────────

export interface CsvImportRow {
  /** Stable client-side id (survives row edits). */
  id: number;
  /** 1-based row number in the file (excluding the header). */
  sourceRow: number;
  values: { address: string; amount: string; memo: string };
  errors: RecipientFieldErrors;
}

/**
 * Parse a CSV file into editable, per-field-validated rows for the batch
 * preview UI. Columns are read by header name (`address`, `amount`, `memo`)
 * when present, falling back to positional columns 1–3. A legacy 4-column
 * template (`address,amount,assetCode,memo`) is supported — the assetCode
 * column is ignored because batch payments are native XLM.
 */
export async function parseRecipientsCsvToRows(
  file: File,
  opts: { selfAddress?: string | null } = {}
): Promise<{ rows: CsvImportRow[]; fileErrors: string[] }> {
  const parsed = parseCsvText(await file.text());
  const fileErrors: string[] = [];

  if (parsed.length < 2) {
    fileErrors.push("CSV must have a header row and at least one data row.");
    return { rows: [], fileErrors };
  }

  const header = parsed[0].map((h) => h.trim().toLowerCase());
  const addressIdx = header.indexOf("address");
  const amountIdx = header.indexOf("amount");
  const memoIdx = header.indexOf("memo");
  const addrI = addressIdx >= 0 ? addressIdx : 0;
  const amtI = amountIdx >= 0 ? amountIdx : 1;
  const memoI = memoIdx >= 0 ? memoIdx : 2;

  const dataRows = parsed.slice(1);
  if (dataRows.length > MAX_BATCH_RECIPIENTS) {
    fileErrors.push(
      `Maximum ${MAX_BATCH_RECIPIENTS} recipients per batch. Remove rows or split the file into multiple batches.`
    );
  }

  const rows: CsvImportRow[] = dataRows.map((cells, idx) => {
    const get = (i: number) => (cells[i] ?? "").trim();
    const values = {
      address: get(addrI),
      amount: get(amtI),
      memo: get(memoI),
    };
    return {
      id: idx + 1,
      sourceRow: idx + 1,
      values,
      errors: validateRecipientFields(
        values.address,
        values.amount,
        values.memo,
        opts
      ),
    };
  });

  applyDuplicateErrors(rows);
  return { rows, fileErrors };
}

// ── Legacy parse (kept for API compatibility) ─────────────────

/** Control characters (C0/C1) — never legitimate memo content. */
const MEMO_CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Parse a CSV file into batch payment recipients.
 * Expected CSV format: address,amount,assetCode,memo
 * First row is treated as a header and skipped.
 */
export async function parseRecipientsCsv(file: File): Promise<{
  recipients: BatchRecipient[];
  errors: { row: number; message: string }[];
}> {
  const parsed = parseCsvText(await file.text());
  const errors: { row: number; message: string }[] = [];
  const recipients: BatchRecipient[] = [];

  if (parsed.length < 2) {
    errors.push({ row: 0, message: "CSV must have a header row and at least one data row." });
    return { recipients, errors };
  }

  for (let i = 1; i < parsed.length; i++) {
    const row = i + 1;
    const cols = parsed[i].map((c) => c.trim());

    if (cols.length < 2) {
      errors.push({ row, message: "Each row must have at least address and amount." });
      continue;
    }

    const [address, amountStr, assetCode = "XLM", memo] = cols;

    if (!/^G[A-Z0-9]{55}$/.test(address)) {
      errors.push({ row, message: `Invalid Stellar address at row ${row}.` });
      continue;
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      errors.push({ row, message: `Invalid amount at row ${row}.` });
      continue;
    }

    // Memo validation mirrors the server-side memoField rules (max
    // MEMO_MAX_BYTES UTF-8 bytes, printable text only) so invalid memos are
    // caught at import time
    // instead of being rejected later by the batch API.
    if (memo) {
      if (MEMO_CONTROL_CHARS.test(memo)) {
        errors.push({
          row,
          message: `Memo at row ${row} must not contain control or invisible characters.`,
        });
        continue;
      }
      if (new TextEncoder().encode(memo).length > MEMO_MAX_BYTES) {
        errors.push({
          row,
          message: `Memo at row ${row} must be 28 bytes or fewer.`,
        });
        continue;
      }
    }

    recipients.push({
      address,
      amount,
      assetCode: assetCode || "XLM",
      memo: memo || undefined,
    });
  }

  return { recipients, errors };
}

// ── Legacy text parser (flexible headers, kept for compatibility) ──

export interface CsvParseError {
  row: number;
  message: string;
}

export interface CsvParseResult {
  recipients: BatchRecipient[];
  errors: CsvParseError[];
}

/**
 * Split a CSV row into fields, correctly handling quoted fields, commas inside
 * quotes, and escaped quotes ("").
 */
export function splitCsvRow(row: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < row.length) {
    const char = row[i];

    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i += 2;
        continue;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
        i++;
        continue;
      }
    }

    if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
      i++;
      continue;
    }

    current += char;
    i++;
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Parse CSV text into batch payment recipients, accepting a 4-column
 * `address,amount,assetCode,memo` layout or flexible named headers
 * (`recipient`/`account`, `value`, `currency`/`asset`/`token`,
 * `note`/`message`). Handles UTF-8 BOM, CRLF/CR line endings, quoted fields,
 * and extra columns. Row-level errors carry the 1-based line number.
 */
export function parseRecipientsCsvText(raw: string): CsvParseResult {
  const errors: CsvParseError[] = [];
  const recipients: BatchRecipient[] = [];

  try {
    if (!raw || typeof raw !== "string") {
      errors.push({ row: 0, message: "CSV content is empty." });
      return { recipients, errors };
    }

    // Strip UTF-8 BOM (U+FEFF) and normalize line endings
    const text = raw
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);

    if (lines.length === 0) {
      errors.push({ row: 0, message: "CSV content is empty." });
      return { recipients, errors };
    }

    if (lines.length < 2) {
      errors.push({
        row: 0,
        message: "CSV must have a header row and at least one data row.",
      });
      return { recipients, errors };
    }

    // Check header row
    const headerCols = splitCsvRow(lines[0]).map((h) =>
      h.toLowerCase().replace(/['"]/g, "")
    );
    const addressIdx = headerCols.findIndex(
      (h) => h === "address" || h === "recipient" || h === "account"
    );
    const amountIdx = headerCols.findIndex(
      (h) => h === "amount" || h === "value"
    );
    const assetIdx = headerCols.findIndex(
      (h) => h === "assetcode" || h === "asset" || h === "currency" || h === "token"
    );
    const memoIdx = headerCols.findIndex(
      (h) => h === "memo" || h === "note" || h === "message"
    );

    // Standard header check or fallback to position-based if valid columns
    const hasNamedHeaders = addressIdx !== -1 && amountIdx !== -1;

    for (let i = 1; i < lines.length; i++) {
      const row = i + 1;
      try {
        const cols = splitCsvRow(lines[i]);

        if (cols.length < 2) {
          errors.push({
            row,
            message: `Row ${row}: Each row must have at least address and amount.`,
          });
          continue;
        }

        let address = "";
        let amountStr = "";
        let assetCode = "XLM";
        let memo: string | undefined = undefined;

        if (hasNamedHeaders) {
          address = cols[addressIdx] || "";
          amountStr = cols[amountIdx] || "";
          if (assetIdx !== -1 && cols[assetIdx]) {
            assetCode = cols[assetIdx];
          }
          if (memoIdx !== -1 && cols[memoIdx]) {
            memo = cols[memoIdx];
          }
        } else {
          // Positional fallback: 0: address, 1: amount, 2: assetCode, 3: memo
          address = cols[0] || "";
          amountStr = cols[1] || "";
          if (cols.length > 2 && cols[2]) {
            assetCode = cols[2];
          }
          if (cols.length > 3 && cols[3]) {
            memo = cols[3];
          }
        }

        address = address.trim();
        amountStr = amountStr.trim();
        assetCode = assetCode.trim();
        if (memo !== undefined) {
          memo = memo.trim();
        }

        if (!address) {
          errors.push({ row, message: `Row ${row}: Missing address.` });
          continue;
        }

        if (!/^G[A-Z0-9]{55}$/.test(address)) {
          errors.push({
            row,
            message: `Row ${row}: Invalid Stellar address "${address}".`,
          });
          continue;
        }

        if (!amountStr) {
          errors.push({ row, message: `Row ${row}: Missing amount.` });
          continue;
        }

        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
          errors.push({
            row,
            message: `Row ${row}: Invalid amount "${amountStr}". Must be a positive number.`,
          });
          continue;
        }

        recipients.push({
          address,
          amount,
          assetCode: assetCode || "XLM",
          memo: memo || undefined,
        });
      } catch (rowErr) {
        errors.push({
          row,
          message: `Row ${row}: Failed to parse row due to unexpected formatting error (${rowErr instanceof Error ? rowErr.message : String(rowErr)}).`,
        });
      }
    }
  } catch (err) {
    errors.push({
      row: 0,
      message: `Failed to parse CSV file (${err instanceof Error ? err.message : String(err)}).`,
    });
  }

  return { recipients, errors };
}

// ── Template ──────────────────────────────────────────────────

/**
 * Generate a CSV template for batch payment imports.
 */
export function generateRecipientsCsvTemplate(): string {
  return "address,amount,assetCode,memo\nGBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5,100,XLM,payroll\n";
}

/**
 * Download the CSV template file.
 */
export function downloadCsvTemplate(): void {
  const csv = generateRecipientsCsvTemplate();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ophirpay-batch-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}
