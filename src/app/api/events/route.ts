// SPDX-License-Identifier: MIT

/**
 * SSE (Server-Sent Events) endpoint for real-time payment event streaming.
 *
 * GET /api/events — subscribe to live payment events
 *
 * Events emitted:
 * - connected — stream established
 * - heartbeat — keep-alive ping every 15 seconds
 * - payment:created — new payment event detected from emitter contract
 *
 * This endpoint polls the PaymentEventEmitter contract on Stellar Testnet
 * every 10 seconds to detect new payment events in real-time.
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

export const dynamic = "force-dynamic";

/**
 * Read a u64 value from the emitter contract using Soroban simulation.
 */
async function readEmitterU64(
  server: rpc.Server,
  contractId: string,
  functionName: string,
  sourcePublicKey: string,
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
  sourcePublicKey: string,
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

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let lastKnownCount = 0;
      const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: false });

      // Use the configured chain-read source account for simulation
      const sourcePublicKey = CHAIN_READ_SOURCE;

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`,
            ),
          );
        } catch {
          closed = true;
        }
      }, 15000);

      // Poll emitter contract every 10 seconds for new events
      const pollEmitter = async () => {
        if (closed) return;
        try {
          const currentCount = await readEmitterU64(
            server,
            EMITTER_CONTRACT_ID,
            "get_event_count",
            sourcePublicKey,
          );

          // Fetch any new events since last poll
          let lastFetched = lastKnownCount;
          for (let id = lastKnownCount + 1; id <= currentCount; id++) {
            const event = await readEmitterEvent(
              server,
              EMITTER_CONTRACT_ID,
              id,
              sourcePublicKey,
            );

            if (event) {
              const payload = {
                event: "payment:created",
                timestamp: new Date().toISOString(),
                paymentId: `evt_${event.id || id}`,
                status: "COMPLETED",
                emitter: event.emitter || "OphirPay",
                payer: event.payer || "",
                payee: event.payee || "",
                amount: event.amount || "0",
                txHash: event.tx_hash || "",
              };
              controller.enqueue(
                encoder.encode(
                  `event: payment:created\ndata: ${JSON.stringify(payload)}\n\n`,
                ),
              );
              lastFetched = id;
            } else {
              // Stop on first failure — retry next poll cycle
              break;
            }
          }

          lastKnownCount = lastFetched;
        } catch {
          // Polling failed — silently retry next cycle
        }
      };

      // Initial connected event
      controller.enqueue(
        encoder.encode(
          `event: connected\ndata: ${JSON.stringify({ message: "SSE stream connected to emitter contract" })}\n\n`,
        ),
      );

      // Get starting count
      try {
        lastKnownCount = await readEmitterU64(
          server,
          EMITTER_CONTRACT_ID,
          "get_event_count",
          sourcePublicKey,
        );
      } catch {
        lastKnownCount = 0;
      }

      // Start polling
      const pollInterval = setInterval(pollEmitter, 10000);
      // Run immediately too
      pollEmitter();

      // Cleanup
      return () => {
        closed = true;
        clearInterval(heartbeat);
        clearInterval(pollInterval);
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
