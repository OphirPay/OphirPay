// SPDX-License-Identifier: MIT

import {
  BASE_RESERVE_PER_TRUSTLINE_XLM,
  TRUSTLINE_ONE_SENTENCE_EXPLANATION,
  getTrustlineStatusMessage,
  type TrustlineInfo,
  type TrustlineStatus,
} from "./trustline";
import type { Transaction } from "@stellar/stellar-sdk";

export interface SimulatedBalanceLine {
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12";
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
  is_authorized?: boolean;
  is_authorized_to_maintain_liabilities?: boolean;
  is_clawback_enabled?: boolean;
}

export interface SimulatedAccount {
  publicKey: string;
  sequence: string;
  subentryCount: number;
  balances: SimulatedBalanceLine[];
}

/**
 * Trustline simulator for deterministic unit and local testing.
 * Simulates Stellar account trustline states, reserve requirements,
 * and change_trust transactions without network dependencies.
 */
export class TrustlineSimulator {
  private accounts = new Map<string, SimulatedAccount>();
  public readonly baseReserveXlm: number = 0.5;

  /**
   * Reset simulator state.
   */
  public reset(): void {
    this.accounts.clear();
  }

  /**
   * Register or fund a simulated account.
   */
  public createAccount(
    publicKey: string,
    initialXlm: string = "10.0000000",
    initialSequence: string = "100"
  ): SimulatedAccount {
    const account: SimulatedAccount = {
      publicKey,
      sequence: initialSequence,
      subentryCount: 0,
      balances: [
        {
          asset_type: "native",
          balance: initialXlm,
        },
      ],
    };
    this.accounts.set(publicKey, account);
    return account;
  }

  /**
   * Retrieve an account or null if unfunded.
   */
  public getAccount(publicKey: string): SimulatedAccount | null {
    return this.accounts.get(publicKey) ?? null;
  }

  /**
   * Compute required reserve for an account: (2 + subentries) * baseReserve.
   */
  public getRequiredReserve(subentryCount: number): number {
    return (2 + subentryCount) * this.baseReserveXlm;
  }

  /**
   * Query trustline status for a given asset.
   */
  public checkTrustline(
    publicKey: string,
    assetCode: string,
    assetIssuer: string
  ): TrustlineInfo {
    const account = this.getAccount(publicKey);
    if (!account) {
      return {
        assetCode,
        assetIssuer,
        hasTrustline: false,
        status: "no_trustline",
        explanation: TRUSTLINE_ONE_SENTENCE_EXPLANATION,
        message: getTrustlineStatusMessage("no_trustline", assetCode),
        actionRequired: true,
        reserveRequirementXlm: BASE_RESERVE_PER_TRUSTLINE_XLM,
      };
    }

    const line = account.balances.find(
      (b) =>
        b.asset_type !== "native" &&
        b.asset_code === assetCode &&
        b.asset_issuer === assetIssuer
    );

    if (!line) {
      return {
        assetCode,
        assetIssuer,
        hasTrustline: false,
        status: "no_trustline",
        explanation: TRUSTLINE_ONE_SENTENCE_EXPLANATION,
        message: getTrustlineStatusMessage("no_trustline", assetCode),
        actionRequired: true,
        reserveRequirementXlm: BASE_RESERVE_PER_TRUSTLINE_XLM,
      };
    }

    let status: TrustlineStatus = "authorized";
    if (line.is_authorized === false) {
      if (line.is_authorized_to_maintain_liabilities === true) {
        status = "unauthorized";
      } else {
        status = "frozen";
      }
    }

    return {
      assetCode,
      assetIssuer,
      hasTrustline: true,
      status,
      balance: line.balance,
      limit: line.limit,
      isAuthorized: line.is_authorized !== false,
      isAuthorizedToMaintainLiabilities: !!line.is_authorized_to_maintain_liabilities,
      isClawbackEnabled: !!line.is_clawback_enabled,
      explanation: TRUSTLINE_ONE_SENTENCE_EXPLANATION,
      message: getTrustlineStatusMessage(status, assetCode),
      actionRequired: status !== "authorized",
      reserveRequirementXlm: BASE_RESERVE_PER_TRUSTLINE_XLM,
    };
  }

  /**
   * Simulate a change_trust operation.
   * If limit is "0", removes the trustline if balance is 0.
   */
  public changeTrust(
    publicKey: string,
    assetCode: string,
    assetIssuer: string,
    limit?: string
  ): { success: boolean; error?: string } {
    const account = this.getAccount(publicKey);
    if (!account) {
      return { success: false, error: "op_no_destination" };
    }

    const nativeBalance =
      account.balances.find((b) => b.asset_type === "native")?.balance ?? "0";
    const xlm = parseFloat(nativeBalance);

    const existingIndex = account.balances.findIndex(
      (b) =>
        b.asset_type !== "native" &&
        b.asset_code === assetCode &&
        b.asset_issuer === assetIssuer
    );

    // Deleting trustline: limit === "0"
    if (limit === "0") {
      if (existingIndex === -1) {
        return { success: false, error: "op_invalid_limit" };
      }
      const existing = account.balances[existingIndex];
      if (parseFloat(existing.balance) > 0) {
        return { success: false, error: "op_cannot_delete" };
      }
      account.balances.splice(existingIndex, 1);
      account.subentryCount = Math.max(0, account.subentryCount - 1);
      return { success: true };
    }

    // Creating new trustline
    if (existingIndex === -1) {
      const requiredReserve = this.getRequiredReserve(account.subentryCount + 1);
      if (xlm < requiredReserve) {
        return { success: false, error: "op_low_reserve" };
      }

      account.subentryCount += 1;
      account.balances.push({
        asset_type: assetCode.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
        asset_code: assetCode,
        asset_issuer: assetIssuer,
        balance: "0.0000000",
        limit: limit ?? "922337203685.4775807",
        is_authorized: true,
        is_authorized_to_maintain_liabilities: true,
        is_clawback_enabled: false,
      });
      return { success: true };
    }

    // Modifying existing trustline limit
    const existing = account.balances[existingIndex];
    if (limit !== undefined && parseFloat(existing.balance) > parseFloat(limit)) {
      return { success: false, error: "op_invalid_limit" };
    }
    existing.limit = limit ?? "922337203685.4775807";
    return { success: true };
  }

  /**
   * Set trustline authorization flags (e.g. freeze, unfreeze, revoke).
   */
  public setTrustlineFlags(
    publicKey: string,
    assetCode: string,
    assetIssuer: string,
    flags: {
      is_authorized?: boolean;
      is_authorized_to_maintain_liabilities?: boolean;
      is_clawback_enabled?: boolean;
    }
  ): boolean {
    const account = this.getAccount(publicKey);
    if (!account) return false;

    const line = account.balances.find(
      (b) =>
        b.asset_type !== "native" &&
        b.asset_code === assetCode &&
        b.asset_issuer === assetIssuer
    );
    if (!line) return false;

    if (flags.is_authorized !== undefined) {
      line.is_authorized = flags.is_authorized;
    }
    if (flags.is_authorized_to_maintain_liabilities !== undefined) {
      line.is_authorized_to_maintain_liabilities =
        flags.is_authorized_to_maintain_liabilities;
    }
    if (flags.is_clawback_enabled !== undefined) {
      line.is_clawback_enabled = flags.is_clawback_enabled;
    }
    return true;
  }

  /**
   * Freeze a trustline.
   */
  public freezeTrustline(
    publicKey: string,
    assetCode: string,
    assetIssuer: string
  ): boolean {
    return this.setTrustlineFlags(publicKey, assetCode, assetIssuer, {
      is_authorized: false,
      is_authorized_to_maintain_liabilities: false,
    });
  }

  /**
   * Restore/authorize a trustline.
   */
  public authorizeTrustline(
    publicKey: string,
    assetCode: string,
    assetIssuer: string
  ): boolean {
    return this.setTrustlineFlags(publicKey, assetCode, assetIssuer, {
      is_authorized: true,
      is_authorized_to_maintain_liabilities: true,
    });
  }

  /**
   * Mark trustline as unauthorized (e.g., maintain liabilities only).
   */
  public setUnauthorizedTrustline(
    publicKey: string,
    assetCode: string,
    assetIssuer: string
  ): boolean {
    return this.setTrustlineFlags(publicKey, assetCode, assetIssuer, {
      is_authorized: false,
      is_authorized_to_maintain_liabilities: true,
    });
  }

  /**
   * Simulate a compiled Stellar Transaction containing change_trust operations.
   */
  public simulateTransaction(tx: Transaction): {
    success: boolean;
    txHash: string;
    error?: string;
  } {
    const source = tx.source;
    const account = this.getAccount(source);
    if (!account) {
      return { success: false, txHash: "", error: "op_no_destination" };
    }

    for (const op of tx.operations) {
      if (op.type === "changeTrust") {
        const line = op.line;
        if (line.isNative()) {
          return { success: false, txHash: "", error: "op_invalid_asset" };
        }
        const assetCode = line.getCode();
        const assetIssuer = line.getIssuer();
        const limit = op.limit;
        const result = this.changeTrust(source, assetCode, assetIssuer, limit);
        if (!result.success) {
          return { success: false, txHash: "", error: result.error };
        }
      }
    }

    // Increment sequence number on success
    account.sequence = (BigInt(account.sequence) + 1n).toString();

    return {
      success: true,
      txHash: "simulated_" + Math.random().toString(16).slice(2, 10),
    };
  }
}

export const defaultTrustlineSimulator = new TrustlineSimulator();
