// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import {
  toBatchItemStatus,
  computeBatchProgress,
  resolveBatchSseStage,
  buildBatchProgressEvent,
  subscribeBatchProgress,
  emitBatchProgressEvent,
} from "@/lib/batch-progress";

describe("toBatchItemStatus", () => {
  it("maps CREATED to pending", () => {
    expect(toBatchItemStatus("CREATED")).toBe("pending");
  });

  it("maps PENDING to pending", () => {
    expect(toBatchItemStatus("PENDING")).toBe("pending");
  });

  it("maps PROCESSING to sent", () => {
    expect(toBatchItemStatus("PROCESSING")).toBe("sent");
  });

  it("maps SIGNED to sent", () => {
    expect(toBatchItemStatus("SIGNED")).toBe("sent");
  });

  it("maps SUBMITTED to sent", () => {
    expect(toBatchItemStatus("SUBMITTED")).toBe("sent");
  });

  it("maps COMPLETED to sent", () => {
    expect(toBatchItemStatus("COMPLETED")).toBe("sent");
  });

  it("maps CONFIRMED to sent", () => {
    expect(toBatchItemStatus("CONFIRMED")).toBe("sent");
  });

  it("maps FAILED to failed", () => {
    expect(toBatchItemStatus("FAILED")).toBe("failed");
  });

  it("maps CANCELLED to failed", () => {
    expect(toBatchItemStatus("CANCELLED")).toBe("failed");
  });

  it("maps undefined to pending", () => {
    expect(toBatchItemStatus(undefined)).toBe("pending");
  });

  it("maps unknown status to pending", () => {
    expect(toBatchItemStatus("UNKNOWN")).toBe("pending");
  });
});

describe("computeBatchProgress", () => {
  it("returns zeroed progress for empty array", () => {
    const result = computeBatchProgress([]);
    expect(result).toEqual({
      total: 0,
      pending: 0,
      sent: 0,
      failed: 0,
      percentComplete: 0,
    });
  });

  it("counts all pending items", () => {
    const payments = [
      { status: "CREATED" },
      { status: "PENDING" },
      { status: "CREATED" },
    ];
    const result = computeBatchProgress(payments);
    expect(result.total).toBe(3);
    expect(result.pending).toBe(3);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.percentComplete).toBe(0);
  });

  it("counts all sent items", () => {
    const payments = [
      { status: "COMPLETED" },
      { status: "SUBMITTED" },
      { status: "CONFIRMED" },
    ];
    const result = computeBatchProgress(payments);
    expect(result.total).toBe(3);
    expect(result.pending).toBe(0);
    expect(result.sent).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.percentComplete).toBe(100);
  });

  it("counts all failed items", () => {
    const payments = [
      { status: "FAILED" },
      { status: "CANCELLED" },
    ];
    const result = computeBatchProgress(payments);
    expect(result.total).toBe(2);
    expect(result.pending).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.percentComplete).toBe(100);
  });

  it("computes mixed statuses correctly", () => {
    const payments = [
      { status: "COMPLETED" },
      { status: "FAILED" },
      { status: "CREATED" },
      { status: "SUBMITTED" },
      { status: "CREATED" },
    ];
    const result = computeBatchProgress(payments);
    expect(result.total).toBe(5);
    expect(result.pending).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.percentComplete).toBe(60);
  });

  it("rounds percentComplete to nearest integer", () => {
    const payments = [
      { status: "COMPLETED" },
      { status: "FAILED" },
      { status: "CREATED" },
    ];
    const result = computeBatchProgress(payments);
    expect(result.percentComplete).toBe(67);
  });

  it("handles single completed item", () => {
    const payments = [{ status: "COMPLETED" }];
    const result = computeBatchProgress(payments);
    expect(result.percentComplete).toBe(100);
    expect(result.sent).toBe(1);
  });

  it("handles single failed item", () => {
    const payments = [{ status: "FAILED" }];
    const result = computeBatchProgress(payments);
    expect(result.percentComplete).toBe(100);
    expect(result.failed).toBe(1);
  });

  it("treats undefined status as pending", () => {
    const payments = [{ status: undefined }, { status: "COMPLETED" }];
    const result = computeBatchProgress(payments);
    expect(result.pending).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.percentComplete).toBe(50);
  });
});

describe("resolveBatchSseStage & pub/sub (#1315)", () => {
  it("maps batch and payment states across queued, simulating, signing, processing, and completed", () => {
    expect(resolveBatchSseStage("CREATED", [{ status: "CREATED" }])).toBe("queued");
    expect(resolveBatchSseStage("PROCESSING", [{ status: "SIMULATING" }])).toBe("simulating");
    expect(resolveBatchSseStage("PROCESSING", [{ status: "SIGNED" }])).toBe("signing");
    expect(
      resolveBatchSseStage("PROCESSING", [{ status: "COMPLETED" }, { status: "PENDING" }])
    ).toBe("processing");
    expect(
      resolveBatchSseStage("COMPLETED", [{ status: "COMPLETED" }, { status: "FAILED" }])
    ).toBe("completed");
  });

  it("publishes progress events to in-memory subscribers and Redis pub/sub", async () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeBatchProgress("batch_1", (evt) => {
      received.push(evt);
    });
    const redisMock = { publish: vi.fn().mockResolvedValue(1) };

    const event = buildBatchProgressEvent("batch_1", "PROCESSING", [
      { status: "COMPLETED" },
      { status: "FAILED" },
      { status: "PENDING" },
    ]);

    await emitBatchProgressEvent(event, redisMock);
    unsubscribe();

    expect(received).toHaveLength(1);
    expect(event.processedCount).toBe(2);
    expect(event.totalCount).toBe(3);
    expect(event.failureCount).toBe(1);
    expect(redisMock.publish).toHaveBeenCalledWith(
      "ophirpay:batch-progress:batch_1",
      expect.stringContaining('"batchId":"batch_1"')
    );
  });
});
