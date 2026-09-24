import { serializeCSV, CSVParseOptions } from './csv-core';

/**
 * Export data as CSV.
 *
 * The export flow simply serialises the rows.  Any domain‑specific
 * formatting (e.g. column ordering) should happen before calling
 * this function.
 */
export interface CSVExportOptions extends CSVParseOptions {
  /** Additional options specific to the export flow. */
}

export function exportCSV(rows: string[][], options: CSVExportOptions = {}): string {
  // The export flow may want to prepend BOM for Excel compatibility
  const serializeOpts: CSVParseOptions = { ...options, prependBom: true };
  return serializeCSV(rows, serializeOpts);
}
