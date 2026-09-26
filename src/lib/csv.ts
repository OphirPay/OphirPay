// SPDX-License-Identifier: MIT

/**
 * CSV export utility — generates and downloads CSV files from array data.
 *
 * All quoting/escaping is delegated to the shared RFC-4180 core
 * (`@/lib/csv/core`, issue #761) so this download helper and the server-side
 * exporters cannot drift.
 */

import { serializeCsv } from "@/lib/csv/core";

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

  const rows: string[][] = [
    columns.map((c) => String(c.header)),
    ...data.map((row) => columns.map((c) => String(row[c.key] ?? ""))),
  ];

  // `quoteCarriageReturn: false` preserves this caller's historical byte
  // output (a bare CR is emitted literally); every other rule is shared.
  const csv = serializeCsv(rows, { delimiter, quoteCarriageReturn: false });
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
