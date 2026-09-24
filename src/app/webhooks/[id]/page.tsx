"use client";
// SPDX-License-Identifier: MIT

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { useApiQuery, useApiMutation, type ApiError } from "@/hooks/useApiQuery";
import { WEBHOOK_EVENT_LABELS } from "@/app/api/webhooks/event-types";
import type { WebhookEventType } from "@/app/api/webhooks/event-types";

interface WebhookData {
  id: string;
  url: string;
  events: string;
  isActive: boolean;
  hasSecret: boolean;
  createdAt: string;
}

interface TestResult {
  delivered: boolean;
  status: "delivered" | "failed";
  event: string;
  test: boolean;
  durationMs: number;
  sentAt: string;
}

interface DeadLetterItem {
  id: string;
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  payload: Record<string, unknown> | string;
  status: string;
  responseCode: number | null;
  latencyMs: number;
  attempts: number;
  errorMessage: string | null;
  isReplay: boolean;
  replayBatchId: string | null;
  deliveredAt: string;
}

interface WebhookDeliveryItem {
  id: string;
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  payload?: Record<string, unknown> | string;
  status: string;
  responseCode: number | null;
  latencyMs: number;
  attempts: number;
  errorMessage: string | null;
  isReplay: boolean;
  replayBatchId: string | null;
  deliveredAt: string;
}

interface MetricsSnapshot {
  webhooks_delivered_total: number;
  webhooks_failed_total: number;
  webhooks_dead_letter_total: number;
  webhooks_timeout_total: number;
  delivery_attempts: Array<{
    delivery_type: string;
    attempt_number: number;
    count: number;
  }>;
  delivery_final_outcomes: Array<{
    delivery_type: string;
    attempt_number: number;
    final_outcome: string;
    count: number;
  }>;
}

interface RedeliverResult {
  message?: string;
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    priorDeliveryId: string;
    newDeliveryId: string;
    success: boolean;
    statusCode?: number;
    errorMessage?: string;
  }>;
}

const SAMPLE_PAYLOAD = {
  event: "payment.completed",
  timestamp: "2026-08-14T00:00:00.000Z",
  test: true,
  data: {
    test: true,
    paymentId: "test_payment_000000000000000000000000",
    amount: "25.00",
    assetCode: "USDC",
    status: "COMPLETED",
    description: "OphirPay test event — no real payment was created",
  },
};

export default function WebhookDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const id = params?.id as string;

  const [result, setResult] = useState<TestResult | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [expandedPayloads, setExpandedPayloads] = useState<Record<string, boolean>>({});
  const [redeliveringAll, setRedeliveringAll] = useState(false);
  const [redeliveringId, setRedeliveringId] = useState<string | null>(null);

  const { data: rawWebhooks, isLoading } = useApiQuery<WebhookData[]>(
    ["webhooks"],
    "/api/webhooks",
  );
  const webhooks = Array.isArray(rawWebhooks) ? rawWebhooks : [];
  const webhook = webhooks.find((w) => w.id === id);

  const {
    data: rawDeadLetters,
    isLoading: loadingDeadLetter,
    refetch: refetchDeadLetter,
  } = useApiQuery<DeadLetterItem[]>(
    ["webhook-dead-letter", id],
    `/api/webhooks/${id}/dead-letter`,
    { enabled: !!id }
  );
  const deadLetters = Array.isArray(rawDeadLetters) ? rawDeadLetters : [];

  const {
    data: rawDeliveries,
    isLoading: loadingDeliveries,
    refetch: refetchDeliveries,
  } = useApiQuery<WebhookDeliveryItem[]>(
    ["webhook-deliveries", id],
    `/api/webhooks/${id}/deliveries?limit=15`,
    { enabled: !!id }
  );
  const deliveries = Array.isArray(rawDeliveries) ? rawDeliveries : [];

  const { data: metricsData } = useApiQuery<MetricsSnapshot>(
    ["metrics-snapshot"],
    "/api/metrics?format=json"
  );

  const testMutation = useApiMutation<undefined, TestResult>(
    `/api/webhooks/${id}/test`,
  );

  const redeliverMutation = useApiMutation<
    { deliveryIds?: string[] } | undefined,
    RedeliverResult
  >(
    `/api/webhooks/${id}/dead-letter/redeliver`,
    {
      invalidateKeys: [
        ["webhook-dead-letter", id],
        ["webhook-deliveries", id],
        ["metrics-snapshot"],
      ],
    }
  );

  const parseEvents = (events: string): WebhookEventType[] => {
    try {
      return JSON.parse(events) as WebhookEventType[];
    } catch {
      return [];
    }
  };

  const togglePayload = (deliveryId: string) => {
    setExpandedPayloads((prev) => ({
      ...prev,
      [deliveryId]: !prev[deliveryId],
    }));
  };

  const handleSendTest = async () => {
    setSendError(null);
    setSending(true);
    setResult(null);
    try {
      const res = await testMutation.mutateAsync(undefined);
      setResult(res);
      if (res.delivered) {
        toast.success("Test event delivered", `Accepted by your endpoint in ${res.durationMs}ms.`);
      } else {
        toast.error("Test event failed", "Your endpoint did not return a 2xx response.");
      }
      refetchDeliveries();
    } catch (err) {
      const apiErr = err as ApiError;
      setSendError(apiErr.message || "Failed to send test event");
    } finally {
      setSending(false);
    }
  };

  const handleBulkRedeliver = async () => {
    if (deadLetters.length === 0 || !webhook?.isActive) return;
    setRedeliveringAll(true);
    try {
      const res = await redeliverMutation.mutateAsync(undefined);
      toast.success(
        "Bulk redelivery completed",
        `Processed ${res.total} event(s): ${res.succeeded} succeeded, ${res.failed} failed.`
      );
      refetchDeadLetter();
      refetchDeliveries();
    } catch (err) {
      const apiErr = err as ApiError;
      toast.error("Bulk redelivery failed", apiErr.message || "Failed to redeliver dead-letter queue.");
    } finally {
      setRedeliveringAll(false);
    }
  };

  const handleSingleRedeliver = async (deliveryId: string) => {
    if (!webhook?.isActive) return;
    setRedeliveringId(deliveryId);
    try {
      const res = await redeliverMutation.mutateAsync({ deliveryIds: [deliveryId] });
      if (res.succeeded > 0) {
        toast.success("Redelivery successful", "Dead-letter event was successfully delivered.");
      } else {
        toast.error("Redelivery failed", res.results[0]?.errorMessage || "Endpoint rejected the redelivery attempt.");
      }
      refetchDeadLetter();
      refetchDeliveries();
    } catch (err) {
      const apiErr = err as ApiError;
      toast.error("Redelivery failed", apiErr.message || "Failed to redeliver event.");
    } finally {
      setRedeliveringId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
        <div className="h-64 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!webhook) {
    return (
      <EmptyState
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-8 h-8 text-gray-400"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
            />
          </svg>
        }
        title="Webhook Not Found"
        description="This endpoint doesn't exist or doesn't belong to your account."
        actionLabel="Back to Webhooks"
        onAction={() => router.push("/webhooks")}
      />
    );
  }

  const events = parseEvents(webhook.events);
  const webhookAttempts = metricsData?.delivery_attempts?.filter(
    (a) => a.delivery_type === "webhook"
  ) ?? [];
  const webhookOutcomes = metricsData?.delivery_final_outcomes?.filter(
    (o) => o.delivery_type === "webhook"
  ) ?? [];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/webhooks"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            ← All webhooks
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <h1 className="font-mono text-base font-semibold text-gray-900 dark:text-white truncate">
              {webhook.url}
            </h1>
            <CopyButton value={webhook.url} />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
              webhook.isActive
                ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
            }`}
          >
            {webhook.isActive ? "Active" : "Paused"}
          </span>
          {deadLetters.length > 0 && (
            <Badge variant="warning" dot>
              {deadLetters.length} Dead-Letter{deadLetters.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>

      {/* Metrics & Performance Dashboard Panel */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Delivery & Outcome Metrics
          </h2>
          <span className="text-xs text-gray-400">Live system counters</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Delivered Total</p>
            <p className="text-2xl font-semibold text-green-600 dark:text-green-400 mt-1">
              {metricsData?.webhooks_delivered_total ?? 0}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">Successful deliveries</p>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Failed Total</p>
            <p className="text-2xl font-semibold text-red-600 dark:text-red-400 mt-1">
              {metricsData?.webhooks_failed_total ?? 0}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">Unsuccessful attempts</p>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Dead-Letter Queue</p>
            <p className="text-2xl font-semibold text-amber-600 dark:text-amber-400 mt-1">
              {metricsData?.webhooks_dead_letter_total ?? deadLetters.length}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">Retries exhausted</p>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Timeouts Total</p>
            <p className="text-2xl font-semibold text-orange-600 dark:text-orange-400 mt-1">
              {metricsData?.webhooks_timeout_total ?? 0}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">Bounded 5000ms limit</p>
          </div>
        </div>

        {/* Detailed Breakdown: Attempts and Final Outcomes */}
        {(webhookAttempts.length > 0 || webhookOutcomes.length > 0) && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
                Attempt Distribution
              </h3>
              <div className="space-y-1.5">
                {webhookAttempts.map((att) => (
                  <div key={att.attempt_number} className="flex justify-between items-center text-xs">
                    <span className="text-gray-600 dark:text-gray-400">
                      Attempt {att.attempt_number}
                    </span>
                    <span className="font-mono font-medium text-gray-900 dark:text-white">
                      {att.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
                Final Outcomes Breakdown
              </h3>
              <div className="space-y-1.5">
                {webhookOutcomes.map((out) => (
                  <div key={`${out.attempt_number}-${out.final_outcome}`} className="flex justify-between items-center text-xs">
                    <span className="text-gray-600 dark:text-gray-400">
                      Attempt {out.attempt_number} &rarr;{" "}
                      <span className={
                        out.final_outcome === "success"
                          ? "text-green-600 dark:text-green-400"
                          : out.final_outcome === "dead_letter"
                          ? "text-amber-600 dark:text-amber-400 font-medium"
                          : "text-red-600 dark:text-red-400"
                      }>
                        {out.final_outcome}
                      </span>
                    </span>
                    <span className="font-mono font-medium text-gray-900 dark:text-white">
                      {out.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dead-Letter Queue (DLQ) Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Dead-Letter Queue
              </h2>
              <Badge variant={deadLetters.length > 0 ? "warning" : "default"}>
                {deadLetters.length} queued
              </Badge>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Deliveries that exhausted all retry attempts. Payloads and last failure reasons are retained for inspection and bulk redelivery.
            </p>
          </div>

          {deadLetters.length > 0 && (
            <Button
              onClick={handleBulkRedeliver}
              disabled={redeliveringAll || !webhook.isActive}
              className="shrink-0 text-xs bg-amber-600 hover:bg-amber-700 text-white"
            >
              {redeliveringAll ? "Redelivering..." : `Bulk Redeliver All (${deadLetters.length})`}
            </Button>
          )}
        </div>

        {loadingDeadLetter ? (
          <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
        ) : deadLetters.length === 0 ? (
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="mx-auto h-8 w-8 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm font-medium text-gray-900 dark:text-white mt-2">
              Dead-letter queue is clear
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
              Any webhook event that exhausts its backoff retry budget or continuously times out will be retained here automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {deadLetters.map((dl) => {
              const isExpanded = !!expandedPayloads[dl.id];
              const isTimeout = dl.errorMessage?.startsWith("TIMEOUT:") || dl.errorMessage?.includes("timed out");

              return (
                <div
                  key={dl.id}
                  className="bg-white dark:bg-gray-900 rounded-xl border border-amber-200 dark:border-amber-900/40 p-4 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="warning">
                        DEAD_LETTER
                      </Badge>
                      <span className="font-mono text-xs font-semibold text-gray-900 dark:text-white">
                        {dl.eventType}
                      </span>
                      <span className="text-xs text-gray-400">
                        ({dl.attempts} attempts exhausted)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        {new Date(dl.deliveredAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      <Button
                        variant="secondary"
                        onClick={() => handleSingleRedeliver(dl.id)}
                        disabled={redeliveringId === dl.id || !webhook.isActive}
                        className="text-xs px-2.5 py-1"
                      >
                        {redeliveringId === dl.id ? "Redelivering..." : "Redeliver"}
                      </Button>
                    </div>
                  </div>

                  {/* Failure reason callout */}
                  <div
                    className={`rounded-lg p-2.5 text-xs flex items-start gap-2 ${
                      isTimeout
                        ? "bg-orange-50 dark:bg-orange-950/20 text-orange-800 dark:text-orange-300 border border-orange-200 dark:border-orange-800"
                        : "bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800"
                    }`}
                  >
                    <span className="font-semibold shrink-0">
                      {isTimeout ? "Timeout Reached:" : "Last Failure Reason:"}
                    </span>
                    <span className="font-mono truncate">
                      {dl.errorMessage || (dl.responseCode ? `HTTP ${dl.responseCode}` : "Connection failed")}
                    </span>
                    {dl.latencyMs > 0 && (
                      <span className="ml-auto shrink-0 text-gray-500 dark:text-gray-400">
                        {dl.latencyMs}ms
                      </span>
                    )}
                  </div>

                  {/* Retained payload toggle */}
                  <div>
                    <button
                      type="button"
                      onClick={() => togglePayload(dl.id)}
                      className="text-xs font-medium text-ophir-600 dark:text-ophir-400 hover:underline flex items-center gap-1"
                    >
                      {isExpanded ? "Hide Retained Payload" : "View Retained Payload"}
                    </button>

                    {isExpanded && (
                      <div className="mt-2 relative">
                        <pre className="text-xs bg-gray-950 text-green-400 rounded-lg p-3 overflow-x-auto max-h-60">
                          {typeof dl.payload === "string"
                            ? dl.payload
                            : JSON.stringify(dl.payload, null, 2)}
                        </pre>
                        <div className="absolute top-2 right-2">
                          <CopyButton
                            value={
                              typeof dl.payload === "string"
                                ? dl.payload
                                : JSON.stringify(dl.payload, null, 2)
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Configuration & Test Event */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Configuration */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Configuration
          </h2>
          <div>
            <p className="text-xs text-gray-400 mb-1">Subscribed events</p>
            <div className="flex flex-wrap gap-1.5">
              {events.length > 0 ? (
                events.map((evt) => (
                  <Badge key={evt} variant="info">
                    {WEBHOOK_EVENT_LABELS[evt] ?? evt}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-gray-400">None</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Signing secret</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {webhook.hasSecret
                ? "Configured — used to sign test and live events."
                : "Not configured."}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Timeout & Retry Budget</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              5,000ms bounded per-attempt timeout &bull; 3 attempts backoff (1s, 2s, 4s)
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Created</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {new Date(webhook.createdAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>

        {/* Send test event */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Send Test Event
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Fires a sample <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">payment.completed</code>{" "}
              payload to your endpoint with a valid HMAC signature. No real payment is
              created — the event is clearly marked <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">test: true</code>.
            </p>
          </div>

          <Button onClick={handleSendTest} disabled={sending || !webhook.isActive}>
            {sending ? "Sending…" : "Send test event"}
          </Button>

          {!webhook.isActive && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Resume this webhook to send a test event.
            </p>
          )}

          {sendError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-600 dark:text-red-400">{sendError}</p>
            </div>
          )}

          {result && (
            <div
              data-testid="test-result"
              className={`p-3 rounded-lg border ${
                result.delivered
                  ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                  : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
              }`}
            >
              <div className="flex items-center justify-between">
                <p
                  className={`text-sm font-medium ${
                    result.delivered
                      ? "text-green-800 dark:text-green-300"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {result.delivered ? "Delivered" : "Failed"}
                </p>
                <Badge variant={result.delivered ? "success" : "danger"}>
                  {result.status}
                </Badge>
              </div>
              <dl className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                <div className="flex justify-between">
                  <dt className="text-gray-400">Event</dt>
                  <dd className="font-mono">{result.event}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Latency</dt>
                  <dd>{result.durationMs} ms</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Sent at</dt>
                  <dd>{new Date(result.sentAt).toLocaleTimeString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Test markers</dt>
                  <dd className="font-mono">test: true</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>

      {/* Recent Deliveries */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Recent Deliveries History
          </h2>
          <span className="text-xs text-gray-400">Last 15 deliveries</span>
        </div>

        {loadingDeliveries ? (
          <p className="text-xs text-gray-400">Loading delivery history...</p>
        ) : deliveries.length === 0 ? (
          <p className="text-xs text-gray-400">No delivery attempts recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {deliveries.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 text-xs bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2.5"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-mono text-gray-700 dark:text-gray-300 font-medium">
                    {d.eventType}
                  </span>
                  {d.isReplay && (
                    <Badge variant="info">
                      replay
                    </Badge>
                  )}
                  {d.attempts > 1 && (
                    <span className="text-[11px] text-gray-400">
                      ({d.attempts} attempts)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={
                      d.status === "SUCCESS"
                        ? "text-green-600 dark:text-green-400 font-medium"
                        : d.status === "DEAD_LETTER"
                        ? "text-amber-600 dark:text-amber-400 font-medium"
                        : "text-red-600 dark:text-red-400 font-medium"
                    }
                  >
                    {d.status}
                    {d.responseCode != null ? ` (${d.responseCode})` : ""}
                  </span>
                  {d.latencyMs > 0 && (
                    <span className="text-gray-400">
                      {d.latencyMs}ms
                    </span>
                  )}
                  <span className="text-gray-400">
                    {new Date(d.deliveredAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sample payload preview */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
          Sample payload
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          This is the exact body (signed with your secret) that gets delivered when you
          send a test event.
        </p>
        <pre className="text-xs bg-gray-900 text-green-400 rounded-lg p-4 overflow-x-auto">
          {JSON.stringify(SAMPLE_PAYLOAD, null, 2)}
        </pre>
      </div>
    </div>
  );
}
