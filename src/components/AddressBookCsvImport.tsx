"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useRef, useState } from "react";
import {
  parseAddressBookCsvText,
  saveAddressBatch,
  downloadAddressBookTemplate,
  type AddressBookImportResult,
  type AddressEntry,
} from "@/lib/address-book";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { shortenAddress } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface AddressBookCsvImportProps {
  open: boolean;
  onClose: () => void;
  onImportSuccess: (counts: { added: number; updated: number }) => void;
}

export function AddressBookCsvImport({
  open,
  onClose,
  onImportSuccess,
}: AddressBookCsvImportProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [importResult, setImportResult] = useState<AddressBookImportResult | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setFileName(null);
    setImportResult(null);
    setIsDragActive(false);
    setShowErrorDetails(true);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const processFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const result = parseAddressBookCsvText(text);
      setFileName(file.name);
      setImportResult(result);
    } catch {
      setFileName(file.name);
      setImportResult({
        validEntries: [],
        errors: [{ row: 1, reason: "Failed to read CSV file format." }],
        totalRows: 0,
        isEmpty: false,
      });
    }
  }, []);

  const handleFiles = useCallback(
    (files: FileList | File[] | null) => {
      const file = files?.[0];
      if (!file) return;
      processFile(file);
      setIsDragActive(false);
    },
    [processFile]
  );

  const handleCommitImport = () => {
    if (!importResult || importResult.validEntries.length === 0) return;
    const counts = saveAddressBatch(importResult.validEntries);
    onImportSuccess(counts);
    handleClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import Address Book from CSV"
      description="Upload a CSV file with contact labels, Stellar addresses, optional memos, and preferred assets."
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCommitImport}
            disabled={!importResult || importResult.validEntries.length === 0}
          >
            {importResult && importResult.validEntries.length > 0
              ? `Import ${importResult.validEntries.length} Contact${
                  importResult.validEntries.length !== 1 ? "s" : ""
                }`
              : "Import Contacts"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Dropzone */}
        {!fileName ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload Address Book CSV file"
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
              Columns: <span className="font-mono">label,address,memo,asset</span>
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                downloadAddressBookTemplate();
              }}
              className="mt-3 text-sm text-ophir-600 dark:text-ophir-400 hover:underline inline-flex items-center gap-1"
            >
              Download sample template
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {fileName}
              </p>
              {importResult && (
                <p
                  className={cn(
                    "text-xs mt-0.5",
                    importResult.errors.length === 0 && !importResult.isEmpty
                      ? "text-green-600 dark:text-green-400"
                      : "text-gray-600 dark:text-gray-400"
                  )}
                >
                  {importResult.isEmpty
                    ? "Empty file"
                    : `${importResult.validEntries.length} valid of ${importResult.totalRows} row${
                        importResult.totalRows !== 1 ? "s" : ""
                      }`}
                  {importResult.errors.length > 0
                    ? ` · ${importResult.errors.length} skipped with error${
                        importResult.errors.length !== 1 ? "s" : ""
                      }`
                    : ""}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  resetState();
                  inputRef.current?.click();
                }}
              >
                Change File
              </Button>
            </div>
          </div>
        )}

        {/* Empty or Header-only Notice */}
        {importResult?.isEmpty && (
          <div
            role="status"
            className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/20 text-blue-800 dark:text-blue-300 space-y-2"
          >
            <div className="flex items-center gap-2 font-medium text-sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-5 h-5 shrink-0 text-blue-600 dark:text-blue-400"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{importResult.message}</span>
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-400 pl-7">
              Make sure your CSV file includes at least one row with contact details
              under the column headers.
            </p>
          </div>
        )}

        {/* Partial Failure / Row Errors Report */}
        {importResult && importResult.errors.length > 0 && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>
                  {importResult.errors.length} row
                  {importResult.errors.length !== 1 ? "s" : ""} skipped due to
                  validation errors
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowErrorDetails(!showErrorDetails)}
                className="text-xs text-amber-700 dark:text-amber-400 hover:underline"
              >
                {showErrorDetails ? "Hide Details" : "View Details"}
              </button>
            </div>

            {showErrorDetails && (
              <div className="max-h-40 overflow-y-auto divide-y divide-amber-200/50 dark:divide-amber-900/30 text-xs">
                {importResult.errors.map((err, i) => (
                  <div key={i} className="py-2 flex items-start gap-2">
                    <span className="font-mono font-medium text-amber-900 dark:text-amber-200 shrink-0">
                      Row {err.row}:
                    </span>
                    <span className="text-amber-800 dark:text-amber-300">
                      {err.reason}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Valid rows are preserved and ready to be imported below.
            </p>
          </div>
        )}

        {/* Valid Rows Preview Table */}
        {importResult && importResult.validEntries.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Preview valid contacts ({importResult.validEntries.length})</span>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden max-h-56 overflow-y-auto">
              <table className="w-full text-xs text-left" data-testid="address-book-import-table">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 sticky top-0">
                  <tr>
                    <th className="py-2 px-3 font-medium">Nickname</th>
                    <th className="py-2 px-3 font-medium">Stellar Address</th>
                    <th className="py-2 px-3 font-medium">Memo</th>
                    <th className="py-2 px-3 font-medium">Asset</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {importResult.validEntries.map((e, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="py-2 px-3 font-medium text-gray-900 dark:text-white">
                        {e.label}
                      </td>
                      <td className="py-2 px-3 font-mono text-gray-600 dark:text-gray-300">
                        {shortenAddress(e.publicKey, 8)}
                      </td>
                      <td className="py-2 px-3 text-gray-500 dark:text-gray-400">
                        {e.memo || "—"}
                      </td>
                      <td className="py-2 px-3 text-gray-500 dark:text-gray-400">
                        {e.asset || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
