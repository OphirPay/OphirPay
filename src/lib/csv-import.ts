import { parseCSV, CSVParseOptions } from './csv-core';

/**
 * Import CSV data into the system.
 *
 * This module is intentionally thin – it delegates all parsing
 * logic to the shared core.  Validation logic lives in the batch
 * validator layer.
 */
export interface CSVImportOptions extends CSVParseOptions {
  /** Additional options specific to the import flow. */
}

export function importCSV(input: string, options: CSVImportOptions = {}): string[][] {
  // The import flow may want to strip BOM by default
  const parseOpts: CSVParseOptions = { ...options, stripBom: true };
  return parseCSV(input, parseOpts);
}
