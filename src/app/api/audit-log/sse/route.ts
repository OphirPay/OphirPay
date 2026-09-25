// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { NextResponse } from "next/server";
import { Contract, TransactionBuilder, scValToNative, nativeToScVal } from "@stellar/stellar-sdk";
import { getSorobanServer, NETWORK_PASSPHRASE } from "@/lib/stellar";
import { DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { withRequestLogging } from "@/lib/request-logging";
import { createBoundedSseStream } from "@/lib/events/bounded-sse-stream";

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

export const GET = withMetrics("GET /api/audit-log/sse", withRequestLogging(async function GET(request?: Request) {
  const clientId = ++clientCounter;
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || DEFAULT_CONTRACT_ID;

  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let safetyTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastSeenId = 0;

  const boundedStream = createBoundedSseStream({
    maxBufferSize: 50,
    heartbeatIntervalMs: 15_000,
    idleTimeoutMs: 45_000,
    requestSignal: request?.signal,
    onTeardown: () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (safetyTimeout) {
        clearTimeout(safetyTimeout);
        safetyTimeout = null;
      }
    },
  });

  // Send connected event immediately
  boundedStream.send("connected", {
    clientId,
    contractId,
    message: "Audit log SSE stream connected",
  });

  // Safety: auto-cleanup after 10 minutes even without an explicit disconnect
  safetyTimeout = setTimeout(() => {
    boundedStream.close("safety_timeout");
  }, 10 * 60 * 1000);

  // Poll contract every 15 seconds for new entries
  pollInterval = setInterval(async () => {
    if (boundedStream.isClosed()) return;
    try {
      const { entries, newLastSeenId } = await pollContractForAuditEntries(
        lastSeenId,
        CHAIN_READ_SOURCE
      );
      lastSeenId = newLastSeenId;

      for (const entry of entries) {
        if (boundedStream.isClosed()) break;
        boundedStream.send("audit:entry", entry);
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
      if (boundedStream.isClosed()) break;
      boundedStream.send("audit:entry", entry);
    }
  } catch { /* silent */ }

  return new NextResponse(boundedStream.stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}));
