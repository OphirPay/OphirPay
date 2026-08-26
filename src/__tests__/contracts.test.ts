// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { ContractErrorType, ContractError, classifyContractError } from "@/lib/contracts";

describe("ContractError", () => {
  it("creates a CONTRACT error", () => {
    const err = new ContractError("execution failed", ContractErrorType.CONTRACT);
    expect(err.type).toBe(ContractErrorType.CONTRACT);
    expect(err.message).toBe("execution failed");
    expect(err.name).toBe("ContractError");
  });
});

describe("classifyContractError", () => {
  it("classifies user rejection errors", () => {
    const err = classifyContractError(new Error("User rejected the request"));
    expect(err.type).toBe(ContractErrorType.USER_REJECTION);
  });

  it("classifies Freighter declined errors", () => {
    const err = classifyContractError(new Error("Transaction was declined by user"));
    expect(err.type).toBe(ContractErrorType.USER_REJECTION);
  });

  it("classifies contract execution errors", () => {
    const err = classifyContractError(new Error("HostError: contract panicked"));
    expect(err.type).toBe(ContractErrorType.CONTRACT);
  });

  it("classifies network errors", () => {
    const err = classifyContractError(new Error("network timeout fetching RPC"));
    expect(err.type).toBe(ContractErrorType.NETWORK);
  });

  it("defaults to CONTRACT for unknown errors", () => {
    const err = classifyContractError(new Error("something unexpected"));
    expect(err.type).toBe(ContractErrorType.CONTRACT);
  });
});
