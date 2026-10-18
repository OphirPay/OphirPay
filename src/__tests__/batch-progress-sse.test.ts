// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  computeBatchProgress,
  formatBatchSseEvent,
  isBatchTerminalStatus,
  mapBatchStatusToStreamState,
  toBatchItemStatus,
} from "@/lib/batch-progress";

describe("Batch Progress SSE & Lifecycle Helpers", () => {
  it("formats SSE events with proper W3C event and data syntax", () => {
    const raw = formatBatchSseEvent("connected", {
      batchId: "batch_123",
      connectedAt: "2026-10-18T12:00:00.000Z",
    });

    expect(raw).toContain("event: connected\n");
    expect(raw).toContain('data: {"batchId":"batch_123"');
    expect(raw.endsWith("\n\n")).toBe(true);
  });

  it("handles string payload in formatBatchSseEvent", () => {
    const raw = formatBatchSseEvent("heartbeat", "keep-alive");
    expect(raw).toBe("event: heartbeat\ndata: keep-alive\n\n");
  });

  it("maps database batch statuses to granular stream states", () => {
    expect(mapBatchStatusToStreamState("CREATED")).toBe("queued");
    expect(mapBatchStatusToStreamState("PENDING")).toBe("queued");
    expect(mapBatchStatusToStreamState("SIMULATING")).toBe("simulating");
    expect(mapBatchStatusToStreamState("SIGNING")).toBe("signing");
    expect(mapBatchStatusToStreamState("PROCESSING")).toBe("processing");
    expect(mapBatchStatusToStreamState("COMPLETED")).toBe("completed");
    expect(mapBatchStatusToStreamState("CONFIRMED")).toBe("completed");
    expect(mapBatchStatusToStreamState("CANCELLED")).toBe("cancelled");
    expect(mapBatchStatusToStreamState("FAILED")).toBe("failed");
    expect(mapBatchStatusToStreamState("UNKNOWN")).toBe("failed");
  });

  it("correctly identifies terminal vs non-terminal batch statuses", () => {
    expect(isBatchTerminalStatus("COMPLETED")).toBe(true);
    expect(isBatchTerminalStatus("confirmed")).toBe(true);
    expect(isBatchTerminalStatus("FAILED")).toBe(true);
    expect(isBatchTerminalStatus("CANCELLED")).toBe(true);

    expect(isBatchTerminalStatus("CREATED")).toBe(false);
    expect(isBatchTerminalStatus("PENDING")).toBe(false);
    expect(isBatchTerminalStatus("PROCESSING")).toBe(false);
    expect(isBatchTerminalStatus("SIGNING")).toBe(false);
  });

  it("maps payment status to batch item status", () => {
    expect(toBatchItemStatus("CREATED")).toBe("pending");
    expect(toBatchItemStatus("PENDING")).toBe("pending");
    expect(toBatchItemStatus("PROCESSING")).toBe("sent");
    expect(toBatchItemStatus("SIGNED")).toBe("sent");
    expect(toBatchItemStatus("SUBMITTED")).toBe("sent");
    expect(toBatchItemStatus("COMPLETED")).toBe("sent");
    expect(toBatchItemStatus("CONFIRMED")).toBe("sent");
    expect(toBatchItemStatus("FAILED")).toBe("failed");
    expect(toBatchItemStatus("CANCELLED")).toBe("failed");
    expect(toBatchItemStatus(undefined)).toBe("pending");
  });

  it("computes accurate batch progress statistics", () => {
    // Empty payments
    expect(computeBatchProgress([])).toEqual({
      total: 0,
      pending: 0,
      sent: 0,
      failed: 0,
      percentComplete: 0,
    });

    // Mixed payments
    const payments = [
      { status: "COMPLETED" },
      { status: "CONFIRMED" },
      { status: "FAILED" },
      { status: "PENDING" },
    ];
    const progress = computeBatchProgress(payments);

    expect(progress.total).toBe(4);
    expect(progress.sent).toBe(2);
    expect(progress.failed).toBe(1);
    expect(progress.pending).toBe(1);
    // (2 sent + 1 failed) / 4 = 75%
    expect(progress.percentComplete).toBe(75);
  });
});
