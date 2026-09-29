"use client";
// SPDX-License-Identifier: MIT

import { useRef, useState } from "react";
import {
  parseAddressBookCsvToRows,
  importAddressBookRows,
  type AddressBookImportRow,
} from "@/lib/address-book";
import { cn } from "@/lib/utils";

interface AddressBookCsvImportProps {
  /** Called after a file is parsed and its valid rows are saved. */
  onImported: (count: number) => void;
}

/** Join a row's per-field errors into a single "reason" message. */
function rowErrorMessage(row: AddressBookImportRow): string {
  return Object.values(row.errors).filter(Boolean).join(" ");
}

export function AddressBookCsvImport({ onImported }: AddressBookCsvImportProps) {
  const [rows, setRows] = useState<AddressBookImportRow[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const invalidRows = rows.filter((r) => Object.keys(r.errors).length > 0);

  const handleFiles = async (files: FileList | File[] | null) => {
    const file = files?.[0];
    if (!file) return;

    setFileName(file.name);
    setImportedCount(null);

    const result = await parseAddressBookCsvToRows(file);
    setRows(result.rows);
    setFileErrors(result.fileErrors);

    if (result.fileErrors.length === 0) {
      const count = importAddressBookRows(result.rows);
      setImportedCount(count);
      if (count > 0) onImported(count);
    }
  };

  return (
    <div className="space-y-4" data-testid="address-book-csv-import">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload address book CSV file"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragActive(true);
        }}
        onDragLeave={() => setIsDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-ophir-500/40",
          isDragActive
            ? "border-ophir-500 bg-ophir-50 dark:bg-ophir-950/30"
            : "border-gray-300 dark:border-gray-700 hover:border-ophir-400 dark:hover:border-ophir-600"
        )}
        data-testid="address-book-csv-dropzone"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          data-testid="address-book-csv-file-input"
          onChange={(e) => {
            setIsDragActive(false);
            handleFiles(e.target.files);
          }}
        />
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {isDragActive
            ? "Drop your CSV here"
            : "Drag & drop your CSV file here, or click to browse"}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Columns: <span className="font-mono">label,address,memo</span> — the
          same format used by &quot;Export CSV&quot;
        </p>
      </div>

      {fileErrors.map((msg, i) => (
        <div
          key={i}
          role="alert"
          className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400"
        >
          {msg}
        </div>
      ))}

      {fileName && fileErrors.length === 0 && (
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-lg border text-sm",
            invalidRows.length === 0
              ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
              : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
          )}
          data-testid="address-book-csv-summary"
        >
          Imported {importedCount ?? 0} of {rows.length} contact
          {rows.length !== 1 ? "s" : ""} from {fileName}
          {invalidRows.length > 0
            ? ` — ${invalidRows.length} row${invalidRows.length !== 1 ? "s" : ""} skipped.`
            : "."}
        </div>
      )}

      {invalidRows.length > 0 && (
        <ul className="space-y-1.5" data-testid="address-book-csv-errors">
          {invalidRows.map((row) => (
            <li
              key={row.id}
              data-testid={`address-book-csv-row-${row.sourceRow}`}
              role="alert"
              className="text-xs text-red-600 dark:text-red-400 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800"
            >
              Row {row.sourceRow}: {rowErrorMessage(row)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
