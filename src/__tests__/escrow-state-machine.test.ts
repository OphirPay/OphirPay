// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  getEscrowStatus,
  getEscrowRole,
  normalizeEscrow,
  decimalToStroops,
  stroopsToDecimal,
  formatStroopAmount,
  type EscrowRecord,
} from "@/lib/escrows";

const DEPOSITOR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BENEFICIARY = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ARBITER = "GCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const OBSERVER = "GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";

describe("Escrow State Machine & Role Authorization", () => {
  const now = 1_700_000_000;
  const sampleEscrow: EscrowRecord = {
    id: 10,
    depositor: DEPOSITOR,
    beneficiary: BENEFICIARY,
    arbiter: ARBITER,
    amount: "5000000000", // 500 XLM in stroops
    asset: "native",
    deadline: now + 3600, // 1 hour in the future
    released: false,
    claimed: false,
    metadata: "Software Milestone 2 Delivery",
  };

  describe("getEscrowStatus (Deterministic 4-State Machine)", () => {
    it("returns LOCKED when not released, not claimed, and before deadline", () => {
      const status = getEscrowStatus(sampleEscrow, now);
      expect(status).toBe("LOCKED");
    });

    it("returns DUE_FOR_CLAIM when deadline has passed but beneficiary has not claimed yet", () => {
      const status = getEscrowStatus(sampleEscrow, now + 3601);
      expect(status).toBe("DUE_FOR_CLAIM");
    });

    it("returns RELEASED when marked released by owner or arbiter", () => {
      const status = getEscrowStatus(
        { ...sampleEscrow, released: true, claimed: true },
        now
      );
      expect(status).toBe("RELEASED");
    });

    it("returns CLAIMED when claimed by beneficiary after deadline", () => {
      const status = getEscrowStatus(
        { ...sampleEscrow, released: false, claimed: true },
        now + 4000
      );
      expect(status).toBe("CLAIMED");
    });
  });

  describe("getEscrowRole (Role-Based Authorization)", () => {
    it("identifies depositor/owner wallet", () => {
      expect(getEscrowRole(sampleEscrow, DEPOSITOR)).toBe("depositor");
      expect(getEscrowRole(sampleEscrow, DEPOSITOR.toLowerCase())).toBe("depositor");
    });

    it("identifies beneficiary wallet", () => {
      expect(getEscrowRole(sampleEscrow, BENEFICIARY)).toBe("beneficiary");
      expect(getEscrowRole(sampleEscrow, BENEFICIARY.toLowerCase())).toBe("beneficiary");
    });

    it("identifies arbiter wallet", () => {
      expect(getEscrowRole(sampleEscrow, ARBITER)).toBe("arbiter");
      expect(getEscrowRole(sampleEscrow, ARBITER.toLowerCase())).toBe("arbiter");
    });

    it("identifies third-party observers without execution permissions", () => {
      expect(getEscrowRole(sampleEscrow, OBSERVER)).toBe("observer");
      expect(getEscrowRole(sampleEscrow, null)).toBe("observer");
      expect(getEscrowRole(sampleEscrow, undefined)).toBe("observer");
    });
  });

  describe("normalizeEscrow", () => {
    it("decodes snake_case contract return value with arbiter", () => {
      const raw = {
        id: 15,
        depositor: DEPOSITOR,
        beneficiary: BENEFICIARY,
        arbiter: ARBITER,
        amount: "1000000000",
        asset: "native",
        deadline: 1700500000,
        released: false,
        claimed: false,
        metadata: "Design specs approval",
      };

      const normalized = normalizeEscrow(raw);
      expect(normalized.id).toBe(15);
      expect(normalized.depositor).toBe(DEPOSITOR);
      expect(normalized.beneficiary).toBe(BENEFICIARY);
      expect(normalized.arbiter).toBe(ARBITER);
      expect(normalized.amount).toBe("1000000000");
      expect(normalized.deadline).toBe(1700500000);
      expect(normalized.released).toBe(false);
      expect(normalized.claimed).toBe(false);
      expect(normalized.metadata).toBe("Design specs approval");
    });

    it("normalizes empty or void arbiter to null", () => {
      const raw = {
        id: 16,
        depositor: DEPOSITOR,
        beneficiary: BENEFICIARY,
        arbiter: null,
        amount: "50000000",
        deadline: 1700500000,
      };

      const normalized = normalizeEscrow(raw);
      expect(normalized.arbiter).toBeNull();
    });
  });

  describe("Stroop Conversions", () => {
    it("converts decimal XLM to stroops and vice versa accurately", () => {
      expect(decimalToStroops(250)).toBe(2_500_000_000n);
      expect(stroopsToDecimal(2_500_000_000n)).toBe(250);
      expect(formatStroopAmount(2_500_000_000n)).toBe("250.00");
    });
  });
});
