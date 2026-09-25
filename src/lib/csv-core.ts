// SPDX-License-Identifier: MIT

/**
 * Unified RFC-4180 compliant CSV parser and serializer core.
 *
 * Implements:
 * - Proper RFC-4180 quoting and escaping (doubled quotes `""`)
 * - UTF-8 Byte Order Mark (BOM: \uFEFF) stripping
 * - Embedded delimiters, quotes, and newlines (CRLF, LF, CR) in quoted fields
 * - Bidirectional round-trip preservation
 * - Configurable delimiter, line endings, and formula injection guard
 */

export interface CsvParseOptions {
  /** Column delimiter (defaults to comma ','). */
  delimiter?: string;
  /** Whether to filter out rows that are entirely blank (defaults to true). */
  dropBlankRows?: boolean;
}

export interface CsvSerializeOptions {
  /** Column delimiter (defaults to comma ','). */
  delimiter?: string;
  /** Record separator (defaults to CRLF '\r\n' per RFC-4180 §2.1). */
  lineEnding?: "\r\n" | "\n";
  /** Prefix formula-trigger characters (=, +, -, @) with a single quote (OWASP). */
  preventFormulaInjection?: boolean;
}

/**
 * Escapes a single value into an RFC-4180 compliant CSV cell.
 */
export function escapeCsvCell(
  val: unknown,
  options: CsvSerializeOptions = {}
): string {
  if (val === null || val === undefined) {
    return "";
  }

  let str = String(val);
  const delimiter = options.delimiter ?? ",";

  if (options.preventFormulaInjection && /^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }

  if (
    str.includes(delimiter) ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Serializes a 2D matrix of cells into an RFC-4180 compliant CSV string.
 */
export function serializeCsv(
  rows: (readonly unknown[])[],
  options: CsvSerializeOptions = {}
): string {
  const delimiter = options.delimiter ?? ",";
  const lineEnding = options.lineEnding ?? "\r\n";

  return rows
    .map((row) =>
      row.map((cell) => escapeCsvCell(cell, options)).join(delimiter)
    )
    .join(lineEnding);
}

/**
 * Serializes an array of object records into CSV format with header row.
 */
export function serializeRecords<T extends object>(
  records: T[],
  columns: { key: keyof T; header: string }[],
  options: CsvSerializeOptions = {}
): string {
  const headerRow = columns.map((c) => String(c.header));
  const dataRows = records.map((record) =>
    columns.map((c) => record[c.key])
  );

  return serializeCsv([headerRow, ...dataRows], options);
}

/**
 * Parses CSV text into a 2D matrix of strings conforming to RFC-4180.
 *
 * Handles:
 * - Leading UTF-8 BOM (\uFEFF)
 * - Quoted fields containing delimiters, quotes (`""`), and newlines
 * - CRLF (\r\n), lone LF (\n), and lone CR (\r) line terminators
 * - Trailing newlines and inputs without a trailing newline
 */
export function parseCsv(
  text: string,
  options: CsvParseOptions = {}
): string[][] {
  const delimiter = options.delimiter ?? ",";
  const dropBlankRows = options.dropBlankRows ?? true;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip leading UTF-8 Byte Order Mark if present
  const clean = text.replace(/^\uFEFF/, "");
  const len = clean.length;
  let i = 0;

  while (i < len) {
    const ch = clean[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote: "" inside a quoted field represents a single literal quote
        if (i + 1 < len && clean[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        // Closing quote
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
      // CRLF or lone CR: consume LF if immediately following
      if (i + 1 < len && clean[i + 1] === "\n") {
        i += 1;
      }
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

  // Push the final cell and row
  row.push(field);
  rows.push(row);

  if (dropBlankRows) {
    return rows.filter((r) => r.some((cell) => cell !== ""));
  }

  return rows;
}
