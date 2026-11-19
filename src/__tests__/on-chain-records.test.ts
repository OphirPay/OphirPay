// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRecentContractRecords } from "@/lib/on-chain-records";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRecentContractRecords", () => {
  it("reads only the most recent 20 records", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      const id = Number(url.split("/").at(-1));
      return new Response(JSON.stringify({
        success: true,
        data: url === "/api/escrows"
          ? { count: 24 }
          : { id, amount: 100 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const records = await fetchRecentContractRecords<{ id: number; amount: number }>("escrows");

    expect(records).toHaveLength(20);
    expect(records[0].id).toBe(24);
    expect(records[19].id).toBe(5);
    expect(requests).toHaveLength(21);
  });

  it("surfaces unavailable contract reads instead of reporting an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: { count: 0, available: false } }),
      { status: 200 },
    )));

    await expect(fetchRecentContractRecords("streams")).rejects.toThrow(/unavailable/i);
  });
});
