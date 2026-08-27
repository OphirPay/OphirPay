// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import { Contract, TransactionBuilder, scValToNative, nativeToScVal } from "@stellar/stellar-sdk";
import { getSorobanServer, NETWORK_PASSPHRASE } from "@/lib/stellar";
import { DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { withRequestLogging } from "@/lib/request-logging";

/** Map of connected SSE clients */
const clients = new Map<string, ReadableStreamDefaultController>();
let clientCounter = 0;

/**
 * Poll the Soroban OphirPayContract for new audit log entries.
 * Compares the latest on-chain entry ID with our last-seen ID.
 */
async function pollContractForAuditEntries(
  lastSeenId: number,
  sourcePublicKey: string
): Promise<{ entries: Array<{ id: number; timestamp: number; action: string; actor: string; target_id: number; details: string }>; newLastSeenId: number }> {
  const server = getSorobanServer();
  const contract = new Contract(
    process.env.NEXT_PUBLIC_CONTRACT_ID || DEFAULT_CONTRACT_ID
  );
  const account = await server.getAccount(sourcePublicKey);

  // Read total audit count
  const countTx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: { minTime: 0, maxTime: 0 },
  })
    .addOperation(contract.call("get_audit_log_count"))
    .build();

  const countSim = await server.simulateTransaction(countTx);
  if ("error" in countSim && countSim.error) return { entries: [], newLastSeenId: lastSeenId };

  let totalCount = 0;
  if ("result" in countSim && countSim.result?.retval) {
    const raw = scValToNative(countSim.result.retval);
    totalCount = typeof raw === "number" ? raw : Number(raw);
  }
  if (totalCount <= lastSeenId)
    return { entries: [], newLastSeenId: lastSeenId };

  // Fetch new entries in range (lastSeenId+1 .. totalCount), capped at 10
  const end = Math.min(totalCount, lastSeenId + 10);
  const entries: Array<{ id: number; timestamp: number; action: string; actor: string; target_id: number; details: string }> = [];

  for (let id = lastSeenId + 1; id <= end; id++) {
    try {
      const entryTx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: NETWORK_PASSPHRASE,
        timebounds: { minTime: 0, maxTime: 0 },
      })
        .addOperation(contract.call("get_audit_entry", nativeToScVal(id, { type: "u64" })))
        .build();

      const sim = await server.simulateTransaction(entryTx);
      if ("result" in sim && sim.result) {
        const raw = scValToNative(sim.result.retval);
        if (raw) {
          entries.push({
            id: Number(raw.id),
            timestamp: Number(raw.timestamp),
            action: String(raw.action ?? ""),
            actor: String(raw.actor ?? ""),
            target_id: Number(raw.target_id ?? 0),
            details: String(raw.details ?? ""),
          });
        }
      }
    } catch {
      // skip failed reads
    }
  }

  return { entries, newLastSeenId: end };
}

export const GET = withRequestLogging(async function GET() {
  const clientId = ++clientCounter;
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || DEFAULT_CONTRACT_ID;

  const stream = new ReadableStream({
    async start(controller) {
      clients.set(String(clientId), controller);
      let lastSeenId = 0;

      // Send connected event immediately
      controller.enqueue(
        new TextEncoder().encode(
          `event: connected\ndata: ${JSON.stringify({ clientId, contractId, message: "Audit log SSE stream connected" })}\n\n`
        )
      );

      let closed = false;
      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let safetyTimeout: ReturnType<typeof setTimeout> | null = null;
      const encoder = new TextEncoder();

      // Cleanup on stream cancel / client disconnect
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pollInterval) clearInterval(pollInterval);
        if (safetyTimeout) clearTimeout(safetyTimeout);
        clients.delete(String(clientId));
      };

      // Typed cancel hook — runs when the client disconnects.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controller as any).signal?.addEventListener("abort", cleanup);

      // Safety: auto-cleanup after 10 minutes even without an explicit
      // disconnect (e.g. runtimes that never surface the abort signal).
      safetyTimeout = setTimeout(cleanup, 10 * 60 * 1000);

      // Poll contract every 15 seconds for new entries
      pollInterval = setInterval(async () => {
        if (closed) return;
        try {
          const { entries, newLastSeenId } = await pollContractForAuditEntries(
            lastSeenId,
            CHAIN_READ_SOURCE
          );
          lastSeenId = newLastSeenId;

          for (const entry of entries) {
            if (closed) break;
            try {
              controller.enqueue(
                encoder.encode(
                  `event: audit:entry\ndata: ${JSON.stringify(entry)}\n\n`
                )
              );
            } catch {
              closed = true;
              break;
            }
          }
        } catch {
          // Poll failed silently — retry next interval
        }
      }, 15_000);

      // Initial poll
      try {
        const { entries, newLastSeenId } = await pollContractForAuditEntries(0, CHAIN_READ_SOURCE);
        lastSeenId = newLastSeenId;
        for (const entry of entries) {
          if (closed) break;
          controller.enqueue(
            encoder.encode(
              `event: audit:entry\ndata: ${JSON.stringify(entry)}\n\n`
            )
          );
        }
      } catch { /* silent */ }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
