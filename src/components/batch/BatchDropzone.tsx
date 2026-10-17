"use client";
// SPDX-License-Identifier: MIT

import { useState, useRef, useCallback, type DragEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/ProgressBar";

export type DropzoneVisualState = "idle" | "active" | "parsing" | "error";

export interface FileMetadata {
  name: string;
  sizeBytes: number;
  rowCount?: number;
}

export interface BatchDropzoneProps {
  onFileSelect: (file: File) => void | Promise<void>;
  isParsing?: boolean;
  parseProgress?: number;
  fileMetadata?: FileMetadata | null;
  showMetadataCard?: boolean;
  onTemplateDownload?: () => void;
  maxRecipients?: number;
  className?: string;
}

/**
 * Validates whether an uploaded/dropped file is a valid CSV.
 */
export function validateCsvFile(file: File): { isValid: boolean; error?: string } {
  const isExtensionValid = file.name.toLowerCase().endsWith(".csv");
  const validMimeTypes = [
    "text/csv",
    "application/vnd.ms-excel",
    "text/plain",
    "application/csv",
    "text/x-csv",
  ];
  // Some OS/browsers provide an empty type string for local files
  const isMimeValid = !file.type || validMimeTypes.includes(file.type.toLowerCase());

  if (!isExtensionValid || !isMimeValid) {
    return {
      isValid: false,
      error: `Invalid file format: "${file.name}" is not a CSV file. Please upload a .csv file.`,
    };
  }

  if (file.size === 0) {
    return {
      isValid: false,
      error: `The file "${file.name}" is empty (0 bytes). Please upload a valid CSV.`,
    };
  }

  return { isValid: true };
}

/**
 * Format bytes into human-readable KB/MB.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Interactive Drag-and-Drop upload zone with parsing progress and metadata feedback.
 */
export function BatchDropzone({
  onFileSelect,
  isParsing = false,
  parseProgress = 0,
  fileMetadata = null,
  showMetadataCard = false,
  onTemplateDownload,
  maxRecipients = 500,
  className,
}: BatchDropzoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const visualState: DropzoneVisualState = isParsing
    ? "parsing"
    : errorMessage
      ? "error"
      : isDragActive
        ? "active"
        : "idle";

  const processFile = useCallback(
    async (file: File) => {
      const validation = validateCsvFile(file);
      if (!validation.isValid) {
        setErrorMessage(validation.error || "Invalid file format.");
        return;
      }

      setErrorMessage(null);
      await onFileSelect(file);
    },
    [onFileSelect]
  );

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  return (
    <div className={cn("w-full space-y-3", className)}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload CSV file"
        aria-busy={isParsing}
        onClick={() => inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ophir-500/40",
          visualState === "active" && "border-ophir-500 bg-ophir-50 dark:bg-ophir-950/40 scale-[1.01]",
          visualState === "parsing" && "border-ophir-400 bg-gray-50/80 dark:bg-gray-900/60 cursor-wait",
          visualState === "error" && "border-red-400 bg-red-50/50 dark:bg-red-950/20",
          visualState === "idle" && "border-gray-300 dark:border-gray-700 hover:border-ophir-400 dark:hover:border-ophir-600 bg-transparent"
        )}
        data-testid="csv-dropzone"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,application/vnd.ms-excel,text/plain"
          className="hidden"
          data-testid="csv-file-input"
          onChange={handleInputChange}
          disabled={isParsing}
        />

        {visualState === "parsing" ? (
          <div className="space-y-3 max-w-sm mx-auto" data-testid="dropzone-parsing-state">
            <div className="flex items-center justify-center space-x-2 text-ophir-600 dark:text-ophir-400">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="text-sm font-semibold">Parsing batch CSV...</span>
            </div>
            <ProgressBar value={parseProgress} showLabel variant="default" className="w-full" />
            <p className="text-xs text-gray-500 dark:text-gray-400">Validating recipient addresses & amounts</p>
          </div>
        ) : visualState === "error" ? (
          <div className="space-y-2 text-center" data-testid="dropzone-error-state">
            <svg
              className="w-10 h-10 mx-auto text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-sm font-medium text-red-600 dark:text-red-400">{errorMessage}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Click or drop another file to try again.</p>
          </div>
        ) : (
          <div className="space-y-2 text-center" data-testid="dropzone-idle-state">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className={cn(
                "w-10 h-10 mx-auto transition-transform duration-200",
                visualState === "active" ? "text-ophir-600 dark:text-ophir-400 scale-110" : "text-gray-400 dark:text-gray-500"
              )}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {visualState === "active"
                ? "Drop your CSV here"
                : "Drag & drop your CSV file here, or click to browse"}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Columns: <span className="font-mono">address,amount,memo</span> — up to {maxRecipients} recipients
            </p>
            {onTemplateDownload && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTemplateDownload();
                }}
                className="mt-2 text-sm text-ophir-600 dark:text-ophir-400 hover:underline inline-block"
              >
                Download template
              </button>
            )}
          </div>
        )}
      </div>

      {/* Visual File Metadata & Metrics Card */}
      {showMetadataCard && fileMetadata && (
        <div
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30"
          data-testid="file-metadata-card"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded bg-ophir-100 dark:bg-ophir-900/40 text-ophir-700 dark:text-ophir-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate" data-testid="metadata-filename">
                {fileMetadata.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="metadata-details">
                {formatFileSize(fileMetadata.sizeBytes)}
                {fileMetadata.rowCount !== undefined && ` · ${fileMetadata.rowCount} row${fileMetadata.rowCount !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
