// SPDX-License-Identifier: MIT

/**
 * Server-side CSV generation for API route export endpoints.
 * Different from the client-side csv.ts which triggers downloads in the browser.
 */

/**
 * Convert an array of objects to CSV string (server-safe, no Blob).
 * `T extends object` (rather than Record<string, unknown>) so interfaces —
 * which have no implicit index signature — are accepted.
 */
export function toCsvString<T extends object>(
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
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    // RFC 4180 §2.6 — a bare carriage return splits the record in Excel and
    // in any reader that treats CR as a line terminator.
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Create a CSV Response object for API download endpoints.
 * `extraHeaders` lets callers attach metadata (e.g. X-Export-Truncated).
 */
export function createCsvResponse(
  filename: string,
  data: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(data, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...extraHeaders,
    },
  });
}
