// SPDX-License-Identifier: MIT

/**
 * CSV export utility — generates and downloads CSV files from array data.
 * Powered by unified RFC-4180 csv-core.
 */

import { serializeRecords, escapeCsvCell } from "@/lib/csv-core";

export interface CsvOptions {
  filename?: string;
  delimiter?: string;
}

/**
 * Escape a CSV field using the shared CSV core escaping logic.
 */
export function escapeCsvField(value: string, delimiter = ","): string {
  return escapeCsvCell(value, { delimiter });
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

  const csv = serializeRecords(data, columns, {
    delimiter,
    lineEnding: "\n",
  });

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
