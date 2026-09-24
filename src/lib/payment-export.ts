import { serializeCSV, CSVParseOptions } from './csv-core';

/**
 * Export payment data as CSV.
 *
 * This is a thin wrapper around the core serializer.  The
 * payment‑export logic (column ordering, formatting) lives
 * elsewhere; this module only concerns itself with CSV
 * formatting.
 */
export interface PaymentExportOptions extends CSVParseOptions {
  /** Additional options specific to payment export. */
}

export function paymentExport(rows: string[][], options: PaymentExportOptions = {}): string {
  // Prepend BOM for compatibility with spreadsheet tools
  const serializeOpts: CSVParseOptions = { ...options, prependBom: true };
  return serializeCSV(rows, serializeOpts);
}
