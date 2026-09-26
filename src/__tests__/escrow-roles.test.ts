// SPDX-License-Identifier: MIT

// Escrow role gating for the escrows UI (issue #798).

import { describe, it, expect } from "vitest";
import {
  canClaim,
  canArbiterRelease,
  isEscrowSettled,
  secondsUntilUnlock,
  type EscrowRecord,
} from "@/lib/escrow";

const NOW = 1_700_000_000;
const base: EscrowRecord = {
  id: 3,
  depositor: "GDEPOSITOR",
  beneficiary: "GBENEFICIARY",
  arbiter: "GARBITER",
  amount: 100,
  asset: "native",
  deadline: NOW + 3600,
  released: false,
  claimed: false,
};

describe("isEscrowSettled", () => {
  it("is true once released or claimed", () => {
    expect(isEscrowSettled(base)).toBe(false);
    expect(isEscrowSettled({ ...base, released: true })).toBe(true);
    expect(isEscrowSettled({ ...base, claimed: true })).toBe(true);
  });
});

describe("secondsUntilUnlock", () => {
  it("counts down and floors at zero", () => {
    expect(secondsUntilUnlock(base, NOW)).toBe(3600);
    expect(secondsUntilUnlock(base, NOW + 7200)).toBe(0);
  });
});

describe("canClaim", () => {
  it("allows the beneficiary past the deadline", () => {
    expect(canClaim(base, "GBENEFICIARY", NOW + 7200)).toBe(true);
  });

  it("denies before the deadline, strangers, and settled escrows", () => {
    expect(canClaim(base, "GBENEFICIARY", NOW)).toBe(false);
    expect(canClaim(base, "GSTRANGER", NOW + 7200)).toBe(false);
    expect(canClaim(base, null, NOW + 7200)).toBe(false);
    expect(canClaim({ ...base, released: true }, "GBENEFICIARY", NOW + 7200)).toBe(false);
    expect(canClaim({ ...base, claimed: true }, "GBENEFICIARY", NOW + 7200)).toBe(false);
  });

  it("matches addresses case-insensitively", () => {
    expect(canClaim(base, "gbeneficiary", NOW + 7200)).toBe(true);
  });
});

describe("canArbiterRelease", () => {
  it("allows the assigned arbiter on unsettled escrows", () => {
    expect(canArbiterRelease(base, "GARBITER")).toBe(true);
    expect(canArbiterRelease(base, "GBENEFICIARY")).toBe(false);
    expect(canArbiterRelease(base, null)).toBe(false);
    expect(canArbiterRelease({ ...base, released: true }, "GARBITER")).toBe(false);
    expect(canArbiterRelease({ ...base, arbiter: null }, "GARBITER")).toBe(false);
  });
});
