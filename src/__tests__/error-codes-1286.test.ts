// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_ERROR_CODE_MAP,
  ERROR_CODES,
  ERROR_STATUS,
} from "@/lib/error-codes";
import {
  PAYMENT_ERROR_MESSAGES,
  PaymentErrorCode,
} from "@/types/contract-abi";

describe("Contract error codes in unregister_hook and accept_ownership (#1286)", () => {
  it("maps HookNotFound (62) and NoPendingOwner (305) in TypeScript error catalog and contract ABI", () => {
    expect(PaymentErrorCode.HookNotFound).toBe(62);
    expect(PaymentErrorCode.NoPendingOwner).toBe(305);
    expect(PAYMENT_ERROR_MESSAGES[PaymentErrorCode.HookNotFound]).toBe(
      "Notification hook not found"
    );
    expect(PAYMENT_ERROR_MESSAGES[PaymentErrorCode.NoPendingOwner]).toBe(
      "No pending ownership transfer has been proposed"
    );

    expect(ERROR_CODES.HOOK_NOT_FOUND).toBe("HOOK_NOT_FOUND");
    expect(ERROR_STATUS.HOOK_NOT_FOUND).toBe(404);
    expect(ERROR_CODES.NO_PENDING_OWNER).toBe("NO_PENDING_OWNER");
    expect(ERROR_STATUS.NO_PENDING_OWNER).toBe(409);
    expect(ERROR_CODES.OWNERSHIP_TRANSFER_NOT_PROPOSED).toBe(
      "OWNERSHIP_TRANSFER_NOT_PROPOSED"
    );
    expect(ERROR_STATUS.OWNERSHIP_TRANSFER_NOT_PROPOSED).toBe(409);

    expect(CONTRACT_ERROR_CODE_MAP[PaymentErrorCode.HookNotFound]).toBe(
      ERROR_CODES.HOOK_NOT_FOUND
    );
    expect(CONTRACT_ERROR_CODE_MAP[PaymentErrorCode.NoPendingOwner]).toBe(
      ERROR_CODES.OWNERSHIP_TRANSFER_NOT_PROPOSED
    );
  });

  it("verifies unregister_hook, accept_ownership, and cancel_payment in Rust contracts", () => {
    const ophirContract = fs.readFileSync(
      path.resolve(process.cwd(), "contracts/ophirpay/src/contract.rs"),
      "utf8"
    );
    const emitterContract = fs.readFileSync(
      path.resolve(process.cwd(), "contracts/emitter/src/lib.rs"),
      "utf8"
    );

    expect(ophirContract).toContain(".ok_or(PaymentError::HookNotFound)?");
    expect(ophirContract).toContain(".ok_or(PaymentError::NoPendingOwner)?");
    expect(ophirContract).toContain(
      "pub fn cancel_payment(env: Env, caller: Address, payment_id: u64) -> Result<(), PaymentError>"
    );
    expect(emitterContract).toContain(
      ".ok_or(EmitterError::OwnershipTransferNotProposed)?"
    );
  });
});
