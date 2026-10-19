import { describe, it, expect } from "vitest";
import { PaymentError, PAYMENT_ERROR_NAMES, ERROR_MESSAGES } from "../types/errors";
import { decodeContractError } from "../lib/contract-errors";
import { EscrowData } from "../types/contract-abi";

/**
 * Dispute cooling-off period helper for SDK / UI (#1353).
 */
export const MIN_DISPUTE_PERIOD = 86_400; // 24 hours in seconds

export function isDisputeCoolingOffActive(
  disputeInitiatedAt: number,
  currentTimestamp: number,
  minPeriod: number = MIN_DISPUTE_PERIOD
): boolean {
  if (disputeInitiatedAt === 0) return false;
  const elapsed = currentTimestamp - disputeInitiatedAt;
  return elapsed < minPeriod;
}

export function validateDisputeResolution(
  escrow: EscrowData,
  currentTimestamp: number,
  bothPartiesSigned: boolean,
  minPeriod: number = MIN_DISPUTE_PERIOD
): { canResolve: boolean; error?: PaymentError } {
  if (escrow.released || escrow.claimed) {
    return { canResolve: false, error: PaymentError.EscrowAlreadyReleased };
  }

  if (bothPartiesSigned) {
    return { canResolve: true };
  }

  if (isDisputeCoolingOffActive(escrow.dispute_initiated_at, currentTimestamp, minPeriod)) {
    return { canResolve: false, error: PaymentError.DisputeCoolingOffActive };
  }

  return { canResolve: true };
}

describe("Escrow Dispute Cooling-Off Window Gate (#1353)", () => {
  it("defines DisputeCoolingOffActive error code 310 in TypeScript catalog", () => {
    expect(PaymentError.DisputeCoolingOffActive).toBe(310);
    expect(PAYMENT_ERROR_NAMES[310]).toBe("DisputeCoolingOffActive");
    expect(ERROR_MESSAGES[310].toLowerCase()).toContain("cooling-off");
    expect(decodeContractError("310").toLowerCase()).toContain("cooling-off");
  });

  it("identifies active cooling-off period correctly within 24 hours", () => {
    const initiatedAt = 1_700_000_000;
    // 10 minutes elapsed
    expect(isDisputeCoolingOffActive(initiatedAt, initiatedAt + 600)).toBe(true);
    // 23 hours 59 minutes elapsed
    expect(isDisputeCoolingOffActive(initiatedAt, initiatedAt + 86_399)).toBe(true);
    // Exactly 24 hours elapsed
    expect(isDisputeCoolingOffActive(initiatedAt, initiatedAt + 86_400)).toBe(false);
    // 25 hours elapsed
    expect(isDisputeCoolingOffActive(initiatedAt, initiatedAt + 90_000)).toBe(false);
  });

  it("prevents premature dispute resolution unless both parties signed", () => {
    const dummyEscrow: EscrowData = {
      id: 1,
      depositor: "GBDEP...",
      beneficiary: "GBBEN...",
      arbiter: "GBARB...",
      amount: BigInt(1_000_000),
      asset: "CASSET...",
      deadline: 1_700_500_000,
      released: false,
      claimed: false,
      metadata: "test escrow",
      dispute_initiated_at: 1_700_000_000,
    };

    // Attempt resolve during cooling-off without mutual signoff
    const premature = validateDisputeResolution(dummyEscrow, 1_700_010_000, false);
    expect(premature.canResolve).toBe(false);
    expect(premature.error).toBe(PaymentError.DisputeCoolingOffActive);

    // Mutual signoff bypasses cooling-off immediately
    const mutual = validateDisputeResolution(dummyEscrow, 1_700_010_000, true);
    expect(mutual.canResolve).toBe(true);
    expect(mutual.error).toBeUndefined();

    // After cooling-off window (86,400s), arbiter can unilaterally resolve
    const postCooling = validateDisputeResolution(dummyEscrow, 1_700_086_401, false);
    expect(postCooling.canResolve).toBe(true);
    expect(postCooling.error).toBeUndefined();
  });

  it("supports configurable dispute timeout window", () => {
    const initiatedAt = 1_700_000_000;
    const customMinPeriod = 3_600; // 1 hour

    expect(isDisputeCoolingOffActive(initiatedAt, initiatedAt + 1_800, customMinPeriod)).toBe(true);
    expect(isDisputeCoolingOffActive(initiatedAt, initiatedAt + 3_601, customMinPeriod)).toBe(false);
  });
});
