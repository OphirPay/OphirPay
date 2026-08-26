// SPDX-License-Identifier: MIT

/**
 * Server-side CSV generation for API route export endpoints.
 * Different from the client-side csv.ts which triggers downloads in the browser.
 */

/**
 * Convert an array of objects to CSV string (server-safe, no Blob).
 */
export function toCsvString<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T; header: string }[]
): string {
  const header = columns.map((c) => escapeField(String(c.header))).join(",");
  const rows = data.map((row) =>
    columns.map((c) => escapeField(String(row[c.key] ?? ""))).join(",")
  );
  return [header, ...rows].join("\n");
}

function escapeField(value: string): string {
  // RFC 4180 §2.6: fields containing a comma, double quote, CR or LF must be
  // enclosed in double quotes. A bare CR was previously left unquoted, which
  // splits the record when the file is opened in Excel or parsed by a reader
  // that treats CR as a line terminator.
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Create a CSV Response object for API download endpoints.
 *
 * `extraHeaders` lets a caller attach export metadata (row counts, truncation
 * flags) without every consumer having to rebuild the Response by hand.
 */
export function createCsvResponse(
  filename: string,
  data: string,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(data, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...extraHeaders,
    },
  });
}
