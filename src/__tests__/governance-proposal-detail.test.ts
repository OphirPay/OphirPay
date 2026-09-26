// SPDX-License-Identifier: MIT

// GET /api/governance/proposals/[id] (issue #808): single proposal plus
// governance config from contract reads; invalid ids rejected.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@/lib/contracts", () => ({
  simulateContractCall: vi.fn(),
  DEFAULT_CONTRACT_ID: "CAAA",
  CHAIN_READ_SOURCE: "test",
}));

vi.mock("@/lib/api-cache", () => ({
  cachedFetch: async (_key: string, fn: () => Promise<unknown>) => fn(),
}));

// Import after mocks are registered.
const { GET } = await import("@/app/api/governance/proposals/[id]/route");
const { simulateContractCall } = await import("@/lib/contracts");

const proposal = {
  id: 7,
  title: "Raise fees",
  description: "desc",
  action_type: "set_fee_config",
  proposer: "GAAA",
  yes_votes: 5,
  no_votes: 2,
  voting_ends_at: 1999999999,
  executed: false,
};
const config = { quorum_bps: 5000, voting_period: 86400 };

function get(id: string) {
  return GET(new Request("http://localhost/api/governance/proposals/1"), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/governance/proposals/[id]", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the proposal with config", async () => {
    vi.mocked(simulateContractCall)
      .mockResolvedValueOnce({ status: "SIMULATED", returnValue: proposal })
      .mockResolvedValueOnce({ status: "SIMULATED", returnValue: config });

    const res = await get("7");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.proposal).toMatchObject({ id: 7, title: "Raise fees" });
    expect(json.data.config).toMatchObject({ quorum_bps: 5000 });
  });

  it("rejects non-numeric ids", async () => {
    const res = await get("abc");
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown proposals", async () => {
    vi.mocked(simulateContractCall).mockResolvedValue({
      status: "SIMULATION_FAILED",
      returnValue: null,
    });

    const res = await get("999");
    expect(res.status).toBe(400);
  });

  it("returns null config when the config read fails", async () => {
    vi.mocked(simulateContractCall)
      .mockResolvedValueOnce({ status: "SIMULATED", returnValue: proposal })
      .mockResolvedValueOnce({ status: "SIMULATION_FAILED", returnValue: null });

    const res = await get("7");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.config).toBeNull();
  });
});
