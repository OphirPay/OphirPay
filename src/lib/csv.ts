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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function exportToCsv<T extends Record<string, any>>(
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

function escapeCsvField(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
