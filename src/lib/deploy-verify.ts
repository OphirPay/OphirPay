// SPDX-License-Identifier: MIT

import { Contract, TransactionBuilder } from "@stellar/stellar-sdk";
import { getSorobanServer, NETWORK_PASSPHRASE } from "@/lib/stellar";
import { logger } from "@/lib/logger";

interface DeployVerification {
  contractId: string;
  network: string;
  wasmHash?: string;
  isDeployed: boolean;
  owner?: string;
  version?: string;
  error?: string;
}

/**
 * Verify that a contract is deployed on the Stellar network by attempting
 * to simulate a read-only call against it.
 */
export async function verifyContractDeployment(
  contractId: string,
  sourcePublicKey: string,
  network: "TESTNET" | "PUBLIC" = "TESTNET"
): Promise<DeployVerification> {
  try {
    const server = getSorobanServer();
    const contract = new Contract(contractId);
    const account = await server.getAccount(sourcePublicKey);

    // Try calling get_owner or get_payment_count
    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: NETWORK_PASSPHRASE,
      timebounds: { minTime: 0, maxTime: 0 },
    })
      .addOperation(contract.call("get_payment_count"))
      .build();

    const sim = await server.simulateTransaction(tx);

    if ("error" in sim && sim.error) {
      return {
        contractId,
        network,
        isDeployed: false,
        error: String(sim.error),
      };
    }

    logger.info("Contract verified", { contractId, network });

    return {
      contractId,
      network,
      isDeployed: true,
    };
  } catch (err) {
    return {
      contractId,
      network,
      isDeployed: false,
      error: err instanceof Error ? err.message : "Verification failed",
    };
  }
}
