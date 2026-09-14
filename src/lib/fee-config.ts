// SPDX-License-Identifier: MIT

import { useApiQuery } from "@/hooks/useApiQuery";
import { getFeeConfig, getFeeCollector } from "@/lib/contract-advanced";

export const MAX_FEE_BPS = 1000; // 10%

export interface FeeConfigData {
  payment_fee_bps: number;
  escrow_fee_bps: number;
  stream_fee_bps: number;
  batch_base_fee: number;
  batch_per_item_fee: number;
  enabled: boolean;
}

export interface FeeUpdateResult {
  success: boolean;
  txHash?: string;
  data?: unknown;
  error?: string;
}

/**
 * Validate that a fee in basis points is within allowed range.
 * Fees must be integers between 0 and MAX_FEE_BPS (1000 = 10%).
 */
export function validateFeeBps(fee: number): boolean {
  return Number.isInteger(fee) && fee >= 0 && fee <= MAX_FEE_BPS;
}

/**
 * Validate all fee configuration values.
 * Returns validation errors for each invalid field.
 */
export function validateFeeConfig(
  paymentFee: number,
  escrowFee: number,
  streamFee: number,
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!validateFeeBps(paymentFee)) {
    errors.push(`Payment fee must be an integer between 0 and ${MAX_FEE_BPS} bps`);
  }
  
  if (!validateFeeBps(escrowFee)) {
    errors.push(`Escrow fee must be an integer between 0 and ${MAX_FEE_BPS} bps`);
  }
  
  if (!validateFeeBps(streamFee)) {
    errors.push(`Stream fee must be an integer between 0 and ${MAX_FEE_BPS} bps`);
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Hook to read fee config from on-chain or API.
 * Falls back to API if contract read fails.
 */
export function useFeeConfig() {
  const { data: rawConfig, isLoading, error } = useApiQuery<FeeConfigData>(
    ["fee-config"],
    "/api/fee-config",
  );
  
  const config = rawConfig && typeof rawConfig === "object" && "payment_fee_bps" in rawConfig
    ? rawConfig
    : null;
    
  return {
    config,
    isLoading,
    error,
  };
}

/**
 * Read fee config directly from contract (read-only simulation).
 * This bypasses the API and reads directly from the Soroban contract.
 */
export async function readFeeConfigFromContract(sourcePublicKey: string): Promise<FeeConfigData | null> {
  try {
    const result = await getFeeConfig(sourcePublicKey);
    // Parse the simulation result based on your contract's return format
    // This is a placeholder - adjust based on actual contract return structure
    if (result && typeof result === 'object') {
      return result as unknown as FeeConfigData;
    }
    return null;
  } catch (error) {
    console.error("Failed to read fee config from contract:", error);
    return null;
  }
}

/**
 * Read fee collector from contract (read-only simulation).
 */
export async function readFeeCollectorFromContract(sourcePublicKey: string): Promise<string | null> {
  try {
    const result = await getFeeCollector(sourcePublicKey);
    // Parse the simulation result - adjust based on actual contract return
    if (result && typeof result === 'string') {
      return result;
    }
    return null;
  } catch (error) {
    console.error("Failed to read fee collector from contract:", error);
    return null;
  }
}