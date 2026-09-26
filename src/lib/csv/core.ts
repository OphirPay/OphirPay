// SPDX-License-Identifier: MIT
//
// ══════════════════════════════════════════════════════════════════════
//  CSV core — the single RFC-4180 parser and serializer (issue #761)
// ══════════════════════════════════════════════════════════════════════
//
//  Quoting, escaping, BOM handling and newline handling used to be
//  re-implemented in four modules (`csv.ts`, `csv-import.ts`,
//  `export-csv.ts`, `payment-export.ts`). A fix to one escaping rule could
//  silently miss the others, and the property tests only guarded whichever
//  module they targeted.
//
//  Everything now funnels through this module:
//
//    • `parseCsv()`            — matrix parser (quotes, escaped quotes,
//                                commas/newlines inside quotes, CRLF/CR/LF,
//                                leading UTF-8 BOM, blank rows dropped).
//    • `splitCsvRecord()`      — single-record splitter for line-oriented
//                                callers (with optional per-cell trim).
//    • `escapeCsvValue()`      — one field escaper.
//    • `serializeCsv()`        — rows → text.
//    • `serializeCsvRecords()` — objects + column defs → text.
//
//  Each call site keeps only the *policy* that is genuinely local to it
//  (delimiter, formula-injection guard, BOM), expressed as options — never a
//  second copy of the parsing/escaping algorithm.

/** Options shared by the serializer functions. */
export interface SerializeCsvOptions {
  /** Field delimiter (default `,`). */
  delimiter?: string;
  /** Record terminator (default `\n`). */
  eol?: string;
  /** Prepend a UTF-8 BOM (default `false`). */
  bom?: boolean;
  /** Neutralize leading `= + - @` with a single quote (OWASP, default `false`). */
  formulaGuard?: boolean;
  /**
   * Treat a bare `\r` as a character that needs quoting (default `true`).
   * RFC 4180 §2.6; disable only for legacy call sites that never quote CR.
   */
  quoteCarriageReturn?: boolean;
}

export interface ParseCsvOptions {
  /** Field delimiter (default `,`). */
  delimiter?: string;
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

/**
 * Parse CSV text into a matrix of cells. Handles quoted fields, escaped
 * quotes (`""` inside a quoted field), delimiters and newlines inside quotes,
 * and CRLF/CR/LF line endings. A leading UTF-8 BOM is stripped, and rows that
 * are entirely blank are dropped.
 */
export function parseCsv(text: string, options: ParseCsvOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const clean = stripBom(text);
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

    if (ch === delimiter) {
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

/**
 * Split a single CSV record into fields, correctly handling quoted fields,
 * delimiters inside quotes and escaped quotes (`""`).
 *
 * Unlike `parseCsv`, this operates on one line and can trim each cell. It is
 * the shared implementation behind the legacy `splitCsvRow` export.
 */
export function splitCsvRecord(
  record: string,
  options: { delimiter?: string; trim?: boolean } = {},
): string[] {
  const delimiter = options.delimiter ?? ",";
  const trim = options.trim ?? false;
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < record.length) {
    const char = record[i];

    if (char === '"') {
      if (inQuotes && record[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i += 2;
        continue;
      }
      // Toggle quote mode
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      fields.push(trim ? current.trim() : current);
      current = "";
      i++;
      continue;
    }

    current += char;
    i++;
  }

  fields.push(trim ? current.trim() : current);
  return fields;
}

/**
 * Escape a single CSV field.
 *
 * @param value   Raw cell text.
 * @param options `formulaGuard` neutralizes spreadsheet formulas; the
 *                delimiter/CR options control exactly when quoting happens.
 */
export function escapeCsvValue(
  value: string,
  options: {
    delimiter?: string;
    formulaGuard?: boolean;
    quoteCarriageReturn?: boolean;
  } = {},
): string {
  const delimiter = options.delimiter ?? ",";
  const quoteCarriageReturn = options.quoteCarriageReturn ?? true;

  let out = value;
  // CSV formula-injection guard (OWASP): spreadsheet apps evaluate cells that
  // begin with = + - @ as formulas (including DDE/UNC paths). Neutralize by
  // prefixing a single quote, which the spreadsheet renders literally.
  if (options.formulaGuard && /^[=+\-@]/.test(out)) {
    out = `'${out}`;
  }
  if (
    out.includes(delimiter) ||
    out.includes('"') ||
    out.includes("\n") ||
    (quoteCarriageReturn && out.includes("\r"))
  ) {
    return `"${out.replace(/"/g, '""')}"`;
  }
  return out;
}

/**
 * Serialize a matrix of cells to CSV text. Every cell is escaped with
 * `escapeCsvValue`.
 */
export function serializeCsv(
  rows: readonly (readonly string[])[],
  options: SerializeCsvOptions = {},
): string {
  const delimiter = options.delimiter ?? ",";
  const eol = options.eol ?? "\n";
  const body = rows
    .map((row) =>
      row
        .map((cell) =>
          escapeCsvValue(cell, {
            delimiter,
            formulaGuard: options.formulaGuard,
            quoteCarriageReturn: options.quoteCarriageReturn,
          }),
        )
        .join(delimiter),
    )
    .join(eol);
  return options.bom ? `\uFEFF${body}` : body;
}

/**
 * Convert objects to CSV text using an explicit column list. `T extends
 * object` (rather than `Record<string, unknown>`) so interfaces — which have
 * no implicit index signature — are accepted.
 */
export function serializeCsvRecords<T extends object>(
  data: readonly T[],
  columns: readonly { key: keyof T; header: string }[],
  options: SerializeCsvOptions = {},
): string {
  const rows: string[][] = [
    columns.map((c) => String(c.header)),
    ...data.map((row) => columns.map((c) => String(row[c.key] ?? ""))),
  ];
  return serializeCsv(rows, options);
}
