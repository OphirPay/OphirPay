"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseRecipientsCsvToRows,
  validateRecipientFields,
  applyDuplicateErrors,
  downloadCsvTemplate,
  MAX_BATCH_RECIPIENTS,
  type CsvImportRow,
} from "@/lib/csv-import";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────

export interface CsvRecipientRow {
  address: string;
  amount: string;
  memo?: string;
}

interface CsvBatchImportProps {
  /** Sender's public key; rows sending to it are flagged as errors. */
  selfAddress?: string | null;
  /** Called with the currently valid rows (always empty when invalid). */
  onRowsChange: (rows: CsvRecipientRow[]) => void;
  /** Called with `true` only when every row is valid and the file parsed. */
  onValidityChange: (valid: boolean) => void;
}

type EditableField = keyof CsvImportRow["values"];

// ── Component ─────────────────────────────────────────────────

export function CsvBatchImport({
  selfAddress,
  onRowsChange,
  onValidityChange,
}: CsvBatchImportProps) {
  const [rows, setRows] = useState<CsvImportRow[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const errorCount = rows.filter(
    (r) => Object.keys(r.errors).length > 0
  ).length;
  const isValid =
    rows.length > 0 &&
    fileErrors.length === 0 &&
    errorCount === 0;

  // Notify the parent whenever the parsed state changes.
  useEffect(() => {
    const validRows = rows
      .filter((r) => Object.keys(r.errors).length === 0)
      .map((r) => ({
        address: r.values.address,
        amount: r.values.amount,
        memo: r.values.memo || undefined,
      }));
    onRowsChange(validRows);
    onValidityChange(isValid);
  }, [rows, fileErrors, isValid, onRowsChange, onValidityChange]);

  const handleFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const file = files?.[0];
      if (!file) return;
      const result = await parseRecipientsCsvToRows(file, { selfAddress });
      setRows(result.rows);
      setFileErrors(result.fileErrors);
      setFileName(file.name);
      setIsDragActive(false);
    },
    [selfAddress]
  );

  const updateCell = (id: number, field: EditableField, value: string) => {
    setRows((prev) => {
      const next = prev.map((r) => {
        if (r.id !== id) return r;
        const values = { ...r.values, [field]: value };
        return {
          ...r,
          values,
          errors: validateRecipientFields(
            values.address,
            values.amount,
            values.memo,
            { selfAddress }
          ),
        };
      });
      applyDuplicateErrors(next);
      return next;
    });
  };

  const removeRow = (id: number) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      applyDuplicateErrors(next);
      return next;
    });
  };

  const clearFile = () => {
    setRows([]);
    setFileErrors([]);
    setFileName(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-4" data-testid="csv-batch-import">
      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload CSV file"
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
        data-testid="csv-dropzone"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          data-testid="csv-file-input"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className={cn(
            "w-10 h-10 mx-auto mb-3",
            isDragActive
              ? "text-ophir-600 dark:text-ophir-400"
              : "text-gray-400 dark:text-gray-500"
          )}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {isDragActive
            ? "Drop your CSV here"
            : "Drag & drop your CSV file here, or click to browse"}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Columns: <span className="font-mono">address,amount,memo</span> — up
          to {MAX_BATCH_RECIPIENTS} recipients
        </p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            downloadCsvTemplate();
          }}
          className="mt-3 text-sm text-ophir-600 dark:text-ophir-400 hover:underline"
        >
          Download template
        </button>
      </div>

      {/* File summary / actions */}
      {fileName && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {fileName}
            </p>
            <p
              className={cn(
                "text-xs mt-0.5",
                isValid
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              )}
              data-testid="csv-summary"
            >
              {rows.length} row{rows.length !== 1 ? "s" : ""}
              {errorCount > 0
                ? ` · ${errorCount} with error${errorCount !== 1 ? "s" : ""}`
                : " · all rows valid"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Replace file
            </button>
            <button
              type="button"
              onClick={clearFile}
              className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              Remove file
            </button>
          </div>
        </div>
      )}

      {/* File-level errors */}
      {fileErrors.map((msg, i) => (
        <div
          key={i}
          role="alert"
          className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400"
        >
          {msg}
        </div>
      ))}

      {/* Row preview */}
      {rows.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="csv-preview-table">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                  <th className="py-2.5 px-3 font-medium w-12">#</th>
                  <th className="py-2.5 px-3 font-medium min-w-[240px]">
                    Address
                  </th>
                  <th className="py-2.5 px-3 font-medium w-36">Amount (XLM)</th>
                  <th className="py-2.5 px-3 font-medium min-w-[160px]">Memo</th>
                  <th className="py-2.5 px-3 font-medium w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const hasErrors = Object.keys(r.errors).length > 0;
                  return (
                    <tr
                      key={r.id}
                      data-testid={`csv-row-${r.sourceRow}`}
                      className={cn(
                        "border-t border-gray-100 dark:border-gray-800/50 align-top",
                        hasErrors &&
                          "bg-red-50/50 dark:bg-red-950/20"
                      )}
                    >
                      <td className="py-3 px-3 text-xs text-gray-500 dark:text-gray-400 font-medium">
                        {r.sourceRow}
                      </td>
                      <td className="py-3 px-3">
                        <CellInput
                          value={r.values.address}
                          error={r.errors.address}
                          placeholder="G... destination address"
                          className="font-mono"
                          onChange={(v) => updateCell(r.id, "address", v)}
                        />
                      </td>
                      <td className="py-3 px-3">
                        <CellInput
                          value={r.values.amount}
                          error={r.errors.amount}
                          placeholder="0.00"
                          inputMode="decimal"
                          className="font-mono"
                          onChange={(v) => updateCell(r.id, "amount", v)}
                        />
                      </td>
                      <td className="py-3 px-3">
                        <CellInput
                          value={r.values.memo}
                          error={r.errors.memo}
                          placeholder="Optional"
                          maxLength={28}
                          onChange={(v) => updateCell(r.id, "memo", v)}
                        />
                      </td>
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => removeRow(r.id)}
                          aria-label={`Remove row ${r.sourceRow}`}
                          className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Status banner */}
      {fileName && (
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-lg border text-sm",
            isValid
              ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
              : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
          )}
          data-testid="csv-status"
        >
          {isValid ? (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4 shrink-0"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
              All {rows.length} row{rows.length !== 1 ? "s" : ""} valid —
              ready to submit.
            </>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4 shrink-0"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
              Fix the highlighted fields above to enable submission.
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Editable cell ─────────────────────────────────────────────

function CellInput({
  value,
  error,
  placeholder,
  className,
  inputMode,
  maxLength,
  onChange,
}: {
  value: string;
  error?: string;
  placeholder?: string;
  className?: string;
  inputMode?: "decimal" | "text";
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={!!error}
        aria-label={placeholder ?? "field"}
        className={cn(
          "w-full px-3 py-2 rounded-lg border text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-ophir-500/40 focus:border-transparent transition-colors",
          error
            ? "border-red-500 dark:border-red-500 focus:ring-red-500/30"
            : "border-gray-200 dark:border-gray-700",
          className
        )}
      />
      {error && (
        <p
          role="alert"
          className="mt-1 text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}
