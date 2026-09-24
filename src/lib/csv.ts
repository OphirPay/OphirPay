/**
 * Re‑exports the core CSV parser/serializer.
 *
 * Keeping this thin wrapper allows legacy imports to continue
 * working while the implementation lives in `csv-core.ts`.
 */
export { parseCSV, serializeCSV, CSVParseOptions } from './csv-core';
