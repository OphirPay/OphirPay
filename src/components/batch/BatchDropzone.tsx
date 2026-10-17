"use client";
// SPDX-License-Identifier: MIT

import { useRef, useState } from "react";
import { downloadCsvTemplate, MAX_BATCH_RECIPIENTS } from "@/lib/csv-import";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cn } from "@/lib/utils";

export type DropzoneVisualState = "idle" | "drag-over" | "parsing" | "error";

export interface BatchFileMetadata {
  name: string;
  sizeBytes: number;
  sizeKb: string;
  rowCount: number;
}

const ALLOWED_CSV_MIMES = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/csv",
  "text/x-csv",
  "application/x-csv",
  "text/comma-separated-values",
  "text/x-comma-separated-values",
  "text/plain",
  "",
]);

/**
 * Format file size in KB (minimum 0.1 KB for non-empty files).
 */
export function formatFileSizeKb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0.0 KB";
  const kb = bytes / 1024;
  return `${Math.max(0.1, Number(kb.toFixed(1))).toFixed(1)} KB`;
}

/**
 * Validate that an uploaded file has a `.csv` extension and an allowed CSV MIME type.
 */
export function validateCsvFile(file: File): { valid: boolean; error?: string } {
  const hasCsvExtension = file.name.toLowerCase().endsWith(".csv");
  const normalizedMime = (file.type || "").split(";")[0].trim().toLowerCase();
  const hasAllowedMime = ALLOWED_CSV_MIMES.has(normalizedMime);

  if (!hasCsvExtension || !hasAllowedMime) {
    return {
      valid: false,
      error: `Invalid file type "${file.name}". Please upload a valid .csv file (text/csv or application/vnd.ms-excel).`,
    };
  }
  return { valid: true };
}

export interface BatchDropzoneProps {
  onFileAccepted: (file: File) => void | Promise<void>;
  onFileRejected?: (errorMessage: string) => void;
  metadata?: BatchFileMetadata | null;
  progress?: number;
  isParsing?: boolean;
  hasError?: boolean;
  errorMessage?: string | null;
}

export function BatchDropzone({
  onFileAccepted,
  onFileRejected,
  metadata = null,
  progress = 0,
  isParsing = false,
  hasError = false,
  errorMessage = null,
}: BatchDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const visualState: DropzoneVisualState = isDragOver
    ? "drag-over"
    : isParsing
      ? "parsing"
      : hasError || Boolean(localError) || Boolean(errorMessage)
        ? "error"
        : "idle";

  const handleCandidateFiles = async (files: FileList | File[] | null) => {
    setIsDragOver(false);
    const file = files?.[0];
    if (!file) return;

    const validation = validateCsvFile(file);
    if (!validation.valid) {
      const msg = validation.error ?? "Only .csv files are supported.";
      setLocalError(msg);
      onFileRejected?.(msg);
      return;
    }

    setLocalError(null);
    await onFileAccepted(file);
  };

  const activeError = localError || errorMessage;

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload CSV file"
        data-testid="csv-dropzone"
        data-state={visualState}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void handleCandidateFiles(e.dataTransfer?.files ?? null);
        }}
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-ophir-500/40",
          visualState === "drag-over" &&
            "border-ophir-500 bg-ophir-50 dark:bg-ophir-950/30",
          visualState === "parsing" &&
            "border-blue-400 bg-blue-50/40 dark:bg-blue-950/20",
          visualState === "error" &&
            "border-red-400 bg-red-50/40 dark:bg-red-950/20",
          visualState === "idle" &&
            "border-gray-300 dark:border-gray-700 hover:border-ophir-400 dark:hover:border-ophir-600"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,application/vnd.ms-excel"
          className="hidden"
          data-testid="csv-file-input"
          onChange={(e) => {
            void handleCandidateFiles(e.target.files);
          }}
        />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className={cn(
            "w-10 h-10 mx-auto mb-3",
            visualState === "drag-over"
              ? "text-ophir-600 dark:text-ophir-400"
              : visualState === "error"
                ? "text-red-500 dark:text-red-400"
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
          {visualState === "drag-over"
            ? "Drop your CSV here"
            : visualState === "parsing"
              ? "Parsing CSV batch file..."
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

      {/* Upload / parse progress bar */}
      {(isParsing || progress > 0) && (
        <div
          className="px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
          data-testid="csv-upload-progress"
        >
          <ProgressBar
            value={progress}
            variant={
              visualState === "error"
                ? "danger"
                : progress >= 100
                  ? "success"
                  : "default"
            }
            showLabel
            label={
              metadata
                ? `${metadata.name} (${metadata.sizeKb} · ${metadata.rowCount} row${metadata.rowCount !== 1 ? "s" : ""})`
                : "Processing CSV..."
            }
          />
        </div>
      )}

      {/* MIME / dropzone rejection toast/alert */}
      {activeError && (
        <div
          role="alert"
          data-testid="csv-dropzone-error"
          className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400"
        >
          {activeError}
        </div>
      )}
    </div>
  );
}
