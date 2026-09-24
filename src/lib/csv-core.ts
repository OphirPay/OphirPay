/**
 * RFC‑4180 compliant CSV parser and serializer.
 *
 * The core is intentionally minimal and pure – it only deals with
 * parsing a string into an array of rows and serialising an array of
 * rows back into a string.  All higher‑level modules (import, export,
 * payment‑export, etc.) should use this API so that a change to the
 * escaping logic automatically propagates everywhere.
 *
 * Features:
 *   * Handles UTF‑8 BOM (removes it on parse, optionally adds on
 *     serialise).
 *   * Supports quoted fields, escaped quotes (`""`), commas, CRLF and
 *     LF newlines.
 *   * Escapes fields that contain commas, quotes or newlines on
 *     serialisation.
 *
 * The implementation is deliberately straightforward – a small
 * state machine that walks the input character by character.  It is
 * fast enough for the expected CSV sizes (hundreds of rows) and
 * avoids pulling in a heavy dependency.
 */

export interface CSVParseOptions {
  /** If true, strip a leading UTF‑8 BOM from the input. */
  stripBom?: boolean;
  /** The delimiter to use.  Defaults to `,`. */
  delimiter?: string;
  /** The newline sequence to use when serialising.  Defaults to CRLF. */
  newline?: string;
  /** If true, prepend a UTF‑8 BOM to the output. */
  prependBom?: boolean;
}

/**
 * Parse a CSV string into an array of rows.
 *
 * @param input The CSV string.
 * @param options Optional parsing options.
 * @returns An array of rows, each row being an array of string fields.
 */
export function parseCSV(input: string, options: CSVParseOptions = {}): string[][] {
  const { stripBom = true, delimiter = ',', newline = '\r\n' } = options;

  // Remove BOM if present
  let data = input;
  if (stripBom && data.charCodeAt(0) === 0xfeff) {
    data = data.slice(1);
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = data.length;

  while (i < len) {
    const ch = data[i];

    if (inQuotes) {
      if (ch === '"') {
        // Look ahead for escaped quote
        if (i + 1 < len && data[i + 1] === '"') {
          field += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === delimiter) {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        // Handle CRLF
        if (i + 1 < len && data[i + 1] === '\n') {
          i++;
        }
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        field += ch;
      }
    }
    i++;
  }

  // Flush the last field/row if any
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Serialise an array of rows into a CSV string.
 *
 * @param rows The rows to serialise.
 * @param options Optional serialisation options.
 * @returns A CSV string.
 */
export function serializeCSV(rows: string[][], options: CSVParseOptions = {}): string {
  const { delimiter = ',', newline = '\r\n', prependBom = false } = options;

  const lines = rows.map(row => {
    return row
      .map(field => {
        let f = field;
        // Escape quotes
        if (f.includes('"')) {
          f = f.replace(/"/g, '""');
        }
        // Quote if necessary
        if (f.includes(delimiter) || f.includes('\n') || f.includes('\r') || f.includes('"')) {
          f = `"${f}"`;
        }
        return f;
      })
      .join(delimiter);
  });

  let result = lines.join(newline);
  if (prependBom) {
    result = '\uFEFF' + result;
  }
  return result;
}
