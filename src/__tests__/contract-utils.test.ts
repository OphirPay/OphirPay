// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { decodeContractError, getContractErrorCatalog } from "@/lib/contract-errors";

describe("decodeContractError", () => {
  it("decodes known Error(Contract, #N) pattern", () => {
    // Code 1 = NotInitialized per the 300-code PaymentError catalog
    expect(decodeContractError("Error(Contract, #1)")).toBe(
      "Contract not initialized: call init() first"
    );
  });

  it("decodes known numeric code", () => {
    // Code 5 = InvalidAmount per the 300-code PaymentError catalog
    expect(decodeContractError("5")).toBe(
      "Invalid amount: must be greater than zero"
    );
  });

  it("returns raw string for unknown errors", () => {
    expect(decodeContractError("UnknownFault")).toBe("UnknownFault");
  });

  it("handles empty string", () => {
    expect(decodeContractError("")).toBe("");
  });
});

describe("getContractErrorCatalog", () => {
  it("returns all known error codes", () => {
    const catalog = getContractErrorCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(10);
    expect(catalog[0]).toHaveProperty("code");
    expect(catalog[0]).toHaveProperty("message");
  });

  it("includes AlreadyVoted (51) in error catalog", () => {
    const catalog = getContractErrorCatalog();
    const entry = catalog.find((e) => e.code === "51");
    expect(entry).toBeDefined();
    expect(entry!.message).toContain("Already voted");
  });

  it("includes ReentrantCall (52) in error catalog", () => {
    const catalog = getContractErrorCatalog();
    const entry = catalog.find((e) => e.code === "52");
    expect(entry).toBeDefined();
    expect(entry!.message).toContain("Reentrant");
  });

  it("includes DepositTooLow (45) in error catalog", () => {
    const catalog = getContractErrorCatalog();
    const entry = catalog.find((e) => e.code === "45");
    expect(entry).toBeDefined();
    expect(entry!.message).toContain("Deposit");
  });
});
