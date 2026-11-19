// SPDX-License-Identifier: MIT

/**
 * CSV export utility — generates and downloads CSV files from array data.
 */

interface CsvOptions {
  filename?: string;
  delimiter?: string;
}

/**
 * Convert array of objects to CSV string and trigger download.
 */
export function exportToCsv<T extends object>(
  data: T[],
  columns: { key: keyof T; header: string }[],
  options: CsvOptions = {}
): void {
  const { filename = "export.csv", delimiter = "," } = options;

  const header = columns.map((c) => escapeCsvField(String(c.header), delimiter)).join(delimiter);
  const rows = data.map((row) =>
    columns
      .map((c) => escapeCsvField(String(row[c.key] ?? ""), delimiter))
      .join(delimiter)
  );

  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Sanitize a field value to protect spreadsheet applications against CSV formula injection (issue #1959).
 * Cells beginning with =, +, -, @, \t, or \r are prefixed with a single quote (').
 */
export function sanitizeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function escapeCsvField(value: string, delimiter: string): string {
  const sanitized = sanitizeCsvField(value);
  if (
    sanitized.includes(delimiter) ||
    sanitized.includes('"') ||
    sanitized.includes("\n") ||
    sanitized.includes("\r")
  ) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}
