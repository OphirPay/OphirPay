// SPDX-License-Identifier: MIT
"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────

export type DropzoneState = "idle" | "drag-over" | "parsing" | "error";

export interface DropzoneFile {
  name: string;
  size: number;
  type: string;
  rowCount: number;
}

interface BatchDropzoneProps {
  /** MIME types accepted (default: CSV types). */
  acceptedMimeTypes?: string[];
  /** File extensions accepted (default: .csv). */
  acceptedExtensions?: string[];
  /** Max file size in bytes (default: 10 MB). */
  maxFileSizeBytes?: number;
  /** Current state override for programmatic control. */
  stateOverride?: DropzoneState;
  /** Callback when a valid file is dropped or selected. */
  onFileAccepted: (file: File) => void;
  /** Callback when a file is rejected with an error message. */
  onFileRejected?: (reason: string) => void;
  /** Whether the dropzone is disabled. */
  disabled?: boolean;
}

const DEFAULT_MIME_TYPES = ["text/csv", "application/vnd.ms-excel"];
const DEFAULT_EXTENSIONS = [".csv"];
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// ── Component ─────────────────────────────────────────────────

export function BatchDropzone({
  acceptedMimeTypes = DEFAULT_MIME_TYPES,
  acceptedExtensions = DEFAULT_EXTENSIONS,
  maxFileSizeBytes = DEFAULT_MAX_SIZE,
  stateOverride,
  onFileAccepted,
  onFileRejected,
  disabled = false,
}: BatchDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [internalState, setInternalState] = useState<DropzoneState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<DropzoneFile | null>(null);

  const state: DropzoneState = stateOverride ?? internalState;

  const validateFile = useCallback(
    (file: File): string | null => {
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
      if (
        !acceptedExtensions.includes(ext) &&
        !acceptedMimeTypes.includes(file.type)
      ) {
        return `Invalid file type "${file.type || ext}". Accepted: ${acceptedExtensions.join(", ")}`;
      }
      if (file.size > maxFileSizeBytes) {
        return `File too large (${(file.size / 1024).toFixed(1)} KB). Maximum: ${(maxFileSizeBytes / 1024 / 1024).toFixed(0)} MB`;
      }
      if (file.size === 0) {
        return "File is empty.";
      }
      return null;
    },
    [acceptedExtensions, acceptedMimeTypes, maxFileSizeBytes]
  );

  const handleFile = useCallback(
    (file: File | null | undefined) => {
      if (!file || disabled) return;
      setErrorMessage(null);

      const error = validateFile(file);
      if (error) {
        setInternalState("error");
        setErrorMessage(error);
        setFileMeta(null);
        onFileRejected?.(error);
        return;
      }

      setFileMeta({
        name: file.name,
        size: file.size,
        type: file.type,
        rowCount: 0,
      });
      setInternalState("idle");
      onFileAccepted(file);
    },
    [disabled, validateFile, onFileAccepted, onFileRejected]
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current++;
      if (!disabled) {
        setInternalState("drag-over");
        setErrorMessage(null);
      }
    },
    [disabled]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    []
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        if (!disabled) {
          setInternalState("idle");
        }
      }
    },
    [disabled]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      if (disabled) return;

      const files = e.dataTransfer.files;
      if (files.length > 1) {
        setInternalState("error");
        setErrorMessage("Only one file can be uploaded at a time.");
        onFileRejected?.("Multiple files dropped");
        return;
      }
      handleFile(files[0]);
    },
    [disabled, handleFile, onFileRejected]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!disabled) inputRef.current?.click();
      }
    },
    [disabled]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFile(e.target.files?.[0]);
      e.target.value = "";
    },
    [handleFile]
  );

  const clearFile = useCallback(() => {
    setFileMeta(null);
    setErrorMessage(null);
    setInternalState("idle");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const updateRowCount = useCallback((rowCount: number) => {
    setFileMeta((prev) =>
      prev ? { ...prev, rowCount } : { name: "", size: 0, type: "", rowCount }
    );
  }, []);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const stateStyles: Record<DropzoneState, string> = {
    idle: "border-gray-300 dark:border-gray-700 hover:border-ophir-400 dark:hover:border-ophir-600 bg-white dark:bg-transparent",
    "drag-over":
      "border-ophir-500 bg-ophir-50 dark:bg-ophir-950/30 shadow-lg scale-[1.02]",
    parsing: "border-ophir-400 bg-ophir-50/50 dark:bg-ophir-950/20 animate-pulse",
    error:
      "border-red-400 bg-red-50 dark:bg-red-950/30 dark:border-red-500",
  };

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload CSV file"
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ophir-500/40",
          stateStyles[state],
          disabled && "opacity-50 cursor-not-allowed"
        )}
        data-testid="csv-dropzone"
        data-state={state}
      >
        <input
          ref={inputRef}
          type="file"
          accept={acceptedExtensions.join(",")}
          className="hidden"
          data-testid="csv-file-input"
          onChange={handleInputChange}
          disabled={disabled}
        />

        {/* Icon */}
        <div
          className={cn(
            "w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center transition-colors",
            state === "drag-over"
              ? "bg-ophir-100 dark:bg-ophir-900/50"
              : state === "error"
              ? "bg-red-100 dark:bg-red-900/30"
              : "bg-gray-100 dark:bg-gray-800"
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className={cn(
              "w-6 h-6",
              state === "drag-over"
                ? "text-ophir-600 dark:text-ophir-400"
                : state === "error"
                ? "text-red-500"
                : "text-gray-400 dark:text-gray-500"
            )}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d={
                state === "error"
                  ? "M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  : "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              }
            />
          </svg>
        </div>

        {/* Label */}
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {state === "drag-over"
            ? "Drop your CSV here"
            : state === "parsing"
            ? "Parsing file..."
            : state === "error"
            ? "File rejected"
            : "Drag & drop your CSV file here, or click to browse"}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Accepted: {acceptedExtensions.join(", ")} — max{" "}
          {formatSize(maxFileSizeBytes)}
        </p>
      </div>

      {/* Error message */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400"
          data-testid="csv-dropzone-error"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-4 h-4 shrink-0 mt-0.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          {errorMessage}
        </div>
      )}

      {/* File metadata card */}
      {fileMeta && !errorMessage && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30"
          data-testid="csv-dropzone-file-meta"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {fileMeta.name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatSize(fileMeta.size)}
              {fileMeta.rowCount > 0 &&
                ` · ${fileMeta.rowCount} row${fileMeta.rowCount !== 1 ? "s" : ""}`}
            </p>
          </div>
          <button
            type="button"
            onClick={clearFile}
            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
