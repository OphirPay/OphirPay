"use client";
// SPDX-License-Identifier: MIT


import { useState, useEffect, useRef } from "react";
import { shortenAddress, timeAgo } from "@/lib/utils";
import { Breadcrumb } from "@/components/Breadcrumb";

import {
  fetchOnChainPayments,
  type OnChainPayment,
} from "@/lib/contracts";
import { useApiQuery } from "@/hooks/useApiQuery";
import { connectLiveEvents, type LiveTransport } from "@/lib/events/event-client";
import type { LiveEvent } from "@/lib/events/event-source";
import { XLM_STROOPS, getStellarExplorerUrl } from "@/lib/stellar";

type SseEvent = LiveEvent;

export default function EventsPage() {
  const [connected, setConnected] = useState(false);
  const [transport, setTransport] = useState<LiveTransport | null>(null);
  const [liveEvents, setLiveEvents] = useState<SseEvent[]>([]);
  const [viewMode, setViewMode] = useState<"live" | "onchain">("live");
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to latest event
  useEffect(() => {
    if (autoScroll && eventsEndRef.current) {
      eventsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [liveEvents, autoScroll]);

  // Live connection — WebSocket when available, SSE fallback otherwise.
  useEffect(() => {
    return connectLiveEvents({
      onEvent: (evt) => {
        if (evt.event === "payment:created") {
          setLiveEvents((prev) => [evt, ...prev].slice(0, 50));
        }
      },
      onStatus: (status, t) => {
        setConnected(status === "live");
        setTransport(t);
      },
    });
  }, []);

  // Load on-chain data (only when the On-Chain tab is active)
  const {
    data: onChainData,
  } = useApiQuery<{ payments: OnChainPayment[] }>(
    ["events", "onchain"],
    undefined, // REST not used — reads via Soroban simulation below
    {
      enabled: viewMode === "onchain",
      // On-chain reads are N+1 RPC simulations — don't refetch on tab focus
      refetchOnWindowFocus: false,
    },
    () => fetchOnChainPayments(50),
  );
  const onChainPayments = onChainData?.payments ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Events" }]} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Event Streaming</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Real-time payment events from the Stellar blockchain
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              onClick={() => setViewMode("live")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "live"
                  ? "bg-ophir-600 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              {transport === "ws" ? "WS Live" : "SSE Live"}
            </button>
            <button
              onClick={() => setViewMode("onchain")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "onchain"
                  ? "bg-ophir-600 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              On-Chain
            </button>
          </div>
          {/* Connection status */}
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                connected ? "bg-green-500 animate-pulse" : "bg-red-400"
              }`}
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {connected ? "Live" : "Disconnected"}
            </span>
          </div>
        </div>
      </div>

      {viewMode === "live" ? (
        /* Live SSE Feed */
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Live Event Feed
            </h2>
            <span className="text-xs text-gray-400">
              {liveEvents.length} event{liveEvents.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div
            className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[600px] overflow-y-auto"
            onScroll={(e) => {
              const el = e.currentTarget;
              const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
              setAutoScroll(nearBottom);
            }}
          >
            {liveEvents.length === 0 && (
              <div className="text-center py-16">
                <div className="h-12 w-12 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                  <span className="text-2xl">📡</span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Listening for payment events...
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Send a payment to see it appear here in real-time
                </p>
              </div>
            )}
            {liveEvents.map((evt, i) => (
              <div
                key={`${evt.paymentId}-${i}`}
                className="px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-1.5 py-0.5 rounded font-mono font-medium bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400">
                        {evt.event}
                      </span>
                      <span className="text-xs text-gray-400">
                        {timeAgo(new Date().toISOString())}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                      {evt.payer && (
                        <span>Payer: <span className="font-mono">{shortenAddress(evt.payer, 6)}</span></span>
                      )}
                      {evt.payee && (
                        <span>Payee: <span className="font-mono">{shortenAddress(evt.payee, 6)}</span></span>
                      )}
                      {evt.amount && (
                        <span>Amount: <span className="font-medium text-gray-700 dark:text-gray-300">{evt.amount} stroops</span></span>
                      )}
                    </div>
                    {evt.txHash && (
                      <p className="mt-1 text-xs font-mono text-gray-400 truncate">
                        TX: {shortenAddress(evt.txHash, 10)}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* On-Chain Records */
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                  <th className="py-3 px-4 font-medium">#</th>
                  <th className="py-3 px-4 font-medium">From → To</th>
                  <th className="py-3 px-4 font-medium">Amount</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">TX</th>
                </tr>
              </thead>
              <tbody>
                {onChainPayments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <p className="text-sm text-gray-500 dark:text-gray-400">No on-chain records yet</p>
                    </td>
                  </tr>
                )}
                {onChainPayments.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">#{p.id}</td>
                    <td className="py-3 px-4">
                      <span className="text-xs font-mono text-gray-500">
                        {shortenAddress(p.payer, 4)} → {shortenAddress(p.payee, 4)}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-gray-700 dark:text-gray-300">
                      {(p.amountStroops / XLM_STROOPS).toFixed(2)} XLM
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        RECORDED
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {p.txHash && (
                        <a
                          href={getStellarExplorerUrl(p.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-ophir-600 dark:text-ophir-400 hover:underline"
                        >
                          {shortenAddress(p.txHash, 6)}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
