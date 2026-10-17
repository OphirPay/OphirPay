// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

const { mockFindFirst, mockGetAuthContext } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    batch: {
      findFirst: mockFindFirst,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { GET } from "@/app/api/batches/[id]/events/route";
import {
  buildBatchProgressEvent,
  emitBatchProgressEvent,
} from "@/lib/batch-progress";
import { BatchProgress } from "@/components/batch/batch-progress";

const decoder = new TextDecoder();

describe("GET /api/batches/[id]/events & BatchProgress component (#1315)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated and 404 when batch is not found", async () => {
    mockGetAuthContext.mockResolvedValueOnce(null);
    const unauth = await GET(
      new Request("http://localhost/api/batches/b1/events"),
      { params: Promise.resolve({ id: "b1" }) }
    );
    expect(unauth.status).toBe(401);

    mockGetAuthContext.mockResolvedValueOnce({ userId: "user_1" });
    mockFindFirst.mockResolvedValueOnce(null);
    const notFound = await GET(
      new Request("http://localhost/api/batches/b1/events"),
      { params: Promise.resolve({ id: "b1" }) }
    );
    expect(notFound.status).toBe(404);
  });

  it("streams real-time SSE batch progress frames and disconnects on completion", async () => {
    mockGetAuthContext.mockResolvedValueOnce({ userId: "user_1" });
    mockFindFirst.mockResolvedValueOnce({
      id: "b1",
      userId: "user_1",
      status: "PROCESSING",
      payments: [{ status: "PENDING" }, { status: "PENDING" }],
    });

    const res = await GET(
      new Request("http://localhost/api/batches/b1/events"),
      { params: Promise.resolve({ id: "b1" }) }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain("event: processing");

    // Emit incremental progress update -> completed
    await emitBatchProgressEvent(
      buildBatchProgressEvent(
        "b1",
        "COMPLETED",
        [{ status: "COMPLETED" }, { status: "FAILED" }],
        "completed"
      )
    );

    const second = await reader.read();
    const secondText = decoder.decode(second.value);
    expect(secondText).toContain("event: completed");
    expect(secondText).toContain('"processedCount":2');
    expect(secondText).toContain('"failureCount":1');

    // Stream automatically closes after completed frame
    const end = await reader.read();
    expect(end.done).toBe(true);
  });

  it("falls back to HTTP polling when EventSource errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: "b_poll",
            status: "COMPLETED",
            progress: {
              total: 4,
              sent: 3,
              failed: 1,
              pending: 0,
              percentComplete: 100,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    let triggerError: (() => void) | null = null;
    class FakeEventSource {
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor() {
        triggerError = () => this.onerror?.();
      }
      addEventListener() {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);

    const onComplete = vi.fn();
    render(<BatchProgress batchId="b_poll" initialTotal={4} onComplete={onComplete} />);

    await act(async () => {
      triggerError?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId("batch-progress")).toHaveAttribute(
        "data-transport",
        "polling"
      );
      expect(screen.getByTestId("batch-progress-counts")).toHaveTextContent(
        "4 / 4 processed (1 failed)"
      );
    });
    expect(onComplete).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
