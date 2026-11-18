// SPDX-License-Identifier: MIT

/**
 * Soroban RPC Contract Event Subscription Example.
 *
 * Demonstrates how to poll for and decode on-chain contract events emitted by
 * the OphirPay PaymentEventEmitter contract using @stellar/stellar-sdk.
 *
 * Usage:
 *   npx tsx examples/subscribe-events.ts
 *
 * Environment variables (optional):
 *   NEXT_PUBLIC_STELLAR_RPC_URL     - Soroban RPC endpoint (default: testnet)
 *   NEXT_PUBLIC_EMITTER_CONTRACT_ID - Emitter contract ID to monitor
 *   START_LEDGER                    - Ledger sequence to start streaming from
 *   POLL_INTERVAL_MS                - Polling interval in ms (default: 4000)
 */

import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

export interface DecodedPaymentEvent {
  id: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: string;
  payer: string;
  payee: string;
  amount: string;
  txHash: string;
}

export interface SubscriptionConfig {
  rpcUrl?: string;
  contractId?: string;
  startLedger?: number;
  pollIntervalMs?: number;
  onEvent?: (event: DecodedPaymentEvent) => void;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
}

const DEFAULT_RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
  "https://soroban-testnet.stellar.org";

const DEFAULT_CONTRACT_ID =
  process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID ||
  process.env.NEXT_PUBLIC_CONTRACT_ID ||
  "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN";

const DEFAULT_POLL_INTERVAL_MS = 4000;

/**
 * Safely decodes a single raw Soroban event into a typed DecodedPaymentEvent.
 */
export function decodeSorobanEvent(
  rawEvent: rpc.Api.RawEventResponse | rpc.Api.EventResponse
): DecodedPaymentEvent | null {
  try {
    // 1. Decode topics
    const decodedTopics: unknown[] = rawEvent.topic.map((t) => {
      if (typeof t === "string") {
        return scValToNative(xdr.ScVal.fromXDR(t, "base64"));
      }
      return scValToNative(t);
    });

    const topicName = String(decodedTopics[0] ?? "");
    const payer = String(decodedTopics[1] ?? "");
    const payee = String(decodedTopics[2] ?? "");

    // 2. Decode event value
    let rawValue: unknown;
    if (typeof rawEvent.value === "string") {
      rawValue = scValToNative(xdr.ScVal.fromXDR(rawEvent.value, "base64"));
    } else {
      rawValue = scValToNative(rawEvent.value);
    }

    let amount = "0";
    let txHash = "";

    if (Array.isArray(rawValue)) {
      amount = typeof rawValue[0] === "bigint" ? rawValue[0].toString() : String(rawValue[0] ?? "0");
      txHash = String(rawValue[1] ?? "");
    } else if (rawValue && typeof rawValue === "object") {
      const record = rawValue as Record<string, unknown>;
      amount = typeof record.amount === "bigint" ? record.amount.toString() : String(record.amount ?? "0");
      txHash = String(record.tx_hash ?? record.txHash ?? "");
    } else {
      amount = typeof rawValue === "bigint" ? rawValue.toString() : String(rawValue ?? "0");
    }

    const contractId =
      typeof rawEvent.contractId === "string"
        ? rawEvent.contractId
        : rawEvent.contractId
          ? rawEvent.contractId.toString()
          : "";

    return {
      id: rawEvent.id,
      ledger: rawEvent.ledger,
      ledgerClosedAt: rawEvent.ledgerClosedAt,
      contractId,
      topic: topicName,
      payer,
      payee,
      amount,
      txHash,
    };
  } catch (err) {
    console.error(`Failed to decode event ${rawEvent.id}:`, err);
    return null;
  }
}

/**
 * Subscribes to contract events via Soroban RPC by polling getEvents.
 */
export async function subscribeToContractEvents(
  config: SubscriptionConfig = {}
): Promise<void> {
  const rpcUrl = config.rpcUrl || DEFAULT_RPC_URL;
  const contractId = config.contractId || DEFAULT_CONTRACT_ID;
  const pollIntervalMs = config.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  const onEvent =
    config.onEvent ||
    ((evt) => {
      console.log("\n🔔 Payment Event Detected:");
      console.log(`   ID:        ${evt.id}`);
      console.log(`   Ledger:    ${evt.ledger} (${evt.ledgerClosedAt})`);
      console.log(`   Contract:  ${evt.contractId}`);
      console.log(`   Topic:     ${evt.topic}`);
      console.log(`   Payer:     ${evt.payer}`);
      console.log(`   Payee:     ${evt.payee}`);
      console.log(`   Amount:    ${evt.amount} stroops`);
      console.log(`   Tx Hash:   ${evt.txHash}`);
    });

  const server = new rpc.Server(rpcUrl, { allowHttp: false });

  // Resolve starting ledger
  let currentStartLedger = config.startLedger;
  if (!currentStartLedger) {
    try {
      const latestLedgerResponse = await server.getLatestLedger();
      // Start 5 ledgers back (~25 seconds) to catch recent events
      currentStartLedger = Math.max(1, latestLedgerResponse.sequence - 5);
      console.log(
        `[RPC Events] Connected to ${rpcUrl}. Starting from ledger ${currentStartLedger} (latest: ${latestLedgerResponse.sequence})`
      );
    } catch (err) {
      console.warn(`[RPC Events] Failed to fetch latest ledger:`, err);
      currentStartLedger = 1;
    }
  }

  console.log(`[RPC Events] Monitoring contract: ${contractId}`);
  console.log(`[RPC Events] Polling every ${pollIntervalMs}ms... (Press Ctrl+C to stop)`);

  let isRunning = true;
  if (config.signal) {
    config.signal.addEventListener("abort", () => {
      isRunning = false;
    });
  }

  const seenEventIds = new Set<string>();

  while (isRunning) {
    try {
      const getEventsRequest: rpc.Server.GetEventsRequest = {
        startLedger: currentStartLedger,
        filters: [
          {
            type: "contract",
            contractIds: [contractId],
          },
        ],
        limit: 100,
      };

      const response = await server.getEvents(getEventsRequest);

      if (response && response.events) {
        for (const rawEvent of response.events) {
          if (seenEventIds.has(rawEvent.id)) {
            continue;
          }
          seenEventIds.add(rawEvent.id);

          const decoded = decodeSorobanEvent(rawEvent);
          if (decoded) {
            onEvent(decoded);
          }
        }
      }

      if (response && response.latestLedger) {
        // Advance current start ledger to the next ledger
        currentStartLedger = Math.max(currentStartLedger, response.latestLedger + 1);
      }

      // Evict old seen IDs to keep memory bounded
      if (seenEventIds.size > 10000) {
        const idsArray = Array.from(seenEventIds);
        for (let i = 0; i < 2000; i++) {
          seenEventIds.delete(idsArray[i]!);
        }
      }
    } catch (err) {
      if (config.onError) {
        config.onError(err);
      } else {
        console.error(`[RPC Events] Polling error:`, err);
      }
    }

    if (!isRunning) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.log("[RPC Events] Subscription terminated.");
}

// Execute script if run directly
if (process.env.NODE_ENV !== "test" && typeof require !== "undefined" && require.main === module) {
  const controller = new AbortController();

  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT. Shutting down event listener gracefully...");
    controller.abort();
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM. Shutting down event listener gracefully...");
    controller.abort();
  });

  const startLedger = process.env.START_LEDGER
    ? parseInt(process.env.START_LEDGER, 10)
    : undefined;

  subscribeToContractEvents({
    signal: controller.signal,
    startLedger,
  }).catch((err) => {
    console.error("Fatal subscription error:", err);
    process.exit(1);
  });
}
