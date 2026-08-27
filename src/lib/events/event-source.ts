// SPDX-License-Identifier: MIT

/**
 * Shared live-event source.
 *
 * Polls the PaymentEventEmitter contract and normalizes new events into a
 * transport-agnostic `LiveEvent` shape. Both the SSE route and the WebSocket
 * server consume this so every transport delivers the same event stream.
 */

import {
  rpc,
  Contract,
  TransactionBuilder,
  scValToNative,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { EMITTER_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { SOROBAN_RPC_URL, NETWORK_PASSPHRASE } from "@/lib/stellar";

export interface LiveEvent {
  /** Emitter contract event id — stable dedup key across reconnects. */
  id: number;
  event: string;
  timestamp: string;
  paymentId: string;
  status: string;
  emitter?: string;
  payer?: string;
  payee?: string;
  amount?: string;
  txHash?: string;
}

/** A source of live events. Transport code subscribes via `start`. */
export interface LiveEventSource {
  start(onEvent: (event: LiveEvent) => void): void;
  stop(): void;
}

export interface EventSourceOptions {
  /** How often to poll the emitter contract for new events. */
  pollIntervalMs?: number;
  rpcUrl?: string;
  emitterContractId?: string;
  sourcePublicKey?: string;
}

// ── Contract reads ─────────────────────────────────────────────

/**
 * Read a u64 value from the emitter contract using Soroban simulation.
 */
async function readEmitterU64(
  server: rpc.Server,
  contractId: string,
  functionName: string,
  sourcePublicKey: string
): Promise<number> {
  const contract = new Contract(contractId);
  const account = await server.getAccount(sourcePublicKey);

  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: { minTime: 0, maxTime: 0 },
  })
    .addOperation(contract.call(functionName))
    .build();

  const simResponse = await server.simulateTransaction(tx);

  if ("error" in simResponse && simResponse.error) {
    return 0;
  }

  if ("result" in simResponse && simResponse.result) {
    const val = scValToNative(simResponse.result.retval);
    return typeof val === "number" ? val : Number(val);
  }

  return 0;
}

/**
 * Read a PaymentEvent from the emitter contract by ID.
 */
async function readEmitterEvent(
  server: rpc.Server,
  contractId: string,
  eventId: number,
  sourcePublicKey: string
): Promise<Record<string, unknown> | null> {
  const contract = new Contract(contractId);
  const account = await server.getAccount(sourcePublicKey);

  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: { minTime: 0, maxTime: 0 },
  })
    .addOperation(contract.call("get_event", nativeToScVal(eventId)))
    .build();

  const simResponse = await server.simulateTransaction(tx);

  if ("error" in simResponse && simResponse.error) {
    return null;
  }

  if ("result" in simResponse && simResponse.result) {
    try {
      const native = scValToNative(simResponse.result.retval);
      return native as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return null;
}

// ── Payload normalization ──────────────────────────────────────

/**
 * Normalize a raw emitter event into the shared `LiveEvent` shape. The
 * contract event id is preserved as the dedup key so reconnects never
 * replay a duplicate into the UI.
 */
export function normalizeEvent(
  raw: Record<string, unknown>,
  id: number
): LiveEvent {
  const rawId = typeof raw.id === "number" ? raw.id : id;
  return {
    id: rawId,
    event: "payment:created",
    timestamp: new Date().toISOString(),
    paymentId: `evt_${rawId}`,
    status: "COMPLETED",
    emitter: (raw.emitter as string) || "OphirPay",
    payer: (raw.payer as string) || "",
    payee: (raw.payee as string) || "",
    amount: (raw.amount as string) || "0",
    txHash: (raw.tx_hash as string) || "",
  };
}

// ── Source ─────────────────────────────────────────────────────

/**
 * Create a live event source that polls the emitter contract and calls
 * `onEvent` for each new event. Poll failures are silent — the next cycle
 * retries, matching the previous SSE-only behavior.
 */
export function createLiveEventSource(
  options: EventSourceOptions = {}
): LiveEventSource {
  const {
    pollIntervalMs = 10000,
    rpcUrl = SOROBAN_RPC_URL,
    emitterContractId = EMITTER_CONTRACT_ID,
    sourcePublicKey = CHAIN_READ_SOURCE,
  } = options;

  let stopped = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastKnownCount = 0;

  const pollEmitter = async (
    server: rpc.Server,
    onEvent: (event: LiveEvent) => void
  ) => {
    if (stopped) return;
    try {
      const currentCount = await readEmitterU64(
        server,
        emitterContractId,
        "get_event_count",
        sourcePublicKey
      );

      // Fetch any new events since the last poll; stop on first failure and
      // retry on the next cycle.
      for (let id = lastKnownCount + 1; id <= currentCount; id++) {
        const event = await readEmitterEvent(
          server,
          emitterContractId,
          id,
          sourcePublicKey
        );
        if (!event) break;
        onEvent(normalizeEvent(event, id));
        lastKnownCount = id;
      }
    } catch {
      // Polling failed — silently retry next cycle
    }
  };

  return {
    start(onEvent) {
      if (stopped) return;
      const server = new rpc.Server(rpcUrl, { allowHttp: false });

      // Seed the starting count, then poll immediately and on an interval.
      readEmitterU64(
        server,
        emitterContractId,
        "get_event_count",
        sourcePublicKey
      )
        .then((count) => {
          lastKnownCount = count;
          pollEmitter(server, onEvent);
        })
        .catch(() => {
          lastKnownCount = 0;
        });

      pollTimer = setInterval(() => pollEmitter(server, onEvent), pollIntervalMs);
    },
    stop() {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    },
  };
}
