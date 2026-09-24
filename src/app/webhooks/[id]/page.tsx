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
import {
  WEBHOOK_EVENT_LABELS,
  ALL_WEBHOOK_EVENTS,
  type WebhookEventType,
  WEBHOOK_EVENTS,
} from "@/app/api/webhooks/event-types";
import { validateWebhookUrlWithReason } from "@/lib/webhook-url-guard";
import {
  buildWebhookPreview,
  type WebhookDeliveryPreview,
} from "@/lib/webhook-test";

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
  statusCode?: number;
  latencyMs?: number;
  durationMs: number;
  responseBody?: string;
  deliveryId?: string;
  event: string;
  test: boolean;
  sentAt: string;
}

interface DeliveryRecord {
  id: string;
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  status: "SUCCESS" | "FAILED";
  responseCode?: number;
  isReplay: boolean;
  replayBatchId?: string;
  deliveredAt: string;
}

export default function WebhookDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const id = params?.id as string;

  const [result, setResult] = useState<TestResult | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<WebhookEventType>(
    WEBHOOK_EVENTS.PAYMENT_COMPLETED,
  );
  const [previewTab, setPreviewTab] = useState<"wire" | "canonical" | "headers">("wire");

  const { data: rawWebhooks, isLoading } = useApiQuery<WebhookData[]>(
    ["webhooks"],
    "/api/webhooks",
  );
  const webhooks = Array.isArray(rawWebhooks) ? rawWebhooks : [];
  const webhook = webhooks.find((w) => w.id === id);

  // Server-computed preview (includes secret HMAC when available)
  const { data: serverPreview } = useApiQuery<WebhookDeliveryPreview>(
    ["webhook-test-preview", id, selectedEvent],
    webhook ? `/api/webhooks/${id}/test?event=${selectedEvent}` : "",
    { enabled: !!webhook },
  );

  // Recent deliveries for this specific webhook
  const { data: rawDeliveries, isLoading: deliveriesLoading } = useApiQuery<DeliveryRecord[]>(
    ["webhook-deliveries", id],
    webhook ? `/api/webhooks/${id}/deliveries?limit=10` : "",
    { enabled: !!webhook },
  );
  const deliveries = Array.isArray(rawDeliveries) ? rawDeliveries : [];

  const testMutation = useApiMutation<{ event: WebhookEventType } | undefined, TestResult>(
    `/api/webhooks/${id}/test`,
  );

  const parseEvents = (eventsJson: string): WebhookEventType[] => {
    try {
      return JSON.parse(eventsJson) as WebhookEventType[];
    } catch {
      return [];
    }
  };

  const handleSendTest = async () => {
    if (!webhook) return;
    const urlValidation = validateWebhookUrlWithReason(webhook.url);
    if (!urlValidation.safe) {
      setSendError(urlValidation.reason || "Destination URL blocked by security policy");
      return;
    }

    setSendError(null);
    setSending(true);
    setResult(null);
    try {
      const res = await testMutation.mutateAsync({ event: selectedEvent });
      setResult(res);
      const latency = res.latencyMs ?? res.durationMs;
      const statusLabel = res.statusCode ? `HTTP ${res.statusCode}` : (res.delivered ? "HTTP 200" : "Failed");
      if (res.delivered) {
        toast.success(
          "Test event delivered",
          `Accepted by endpoint (${statusLabel}) in ${latency}ms.`,
        );
      } else {
        toast.error(
          "Test event failed",
          `Endpoint returned ${statusLabel} in ${latency}ms.`,
        );
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setSendError(apiErr.message || "Failed to send test event");
      toast.error("Test event error", apiErr.message || "Failed to send test event");
    } finally {
      setSending(false);
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

  const subscribedEvents = parseEvents(webhook.events);
  const availableEvents = subscribedEvents.length > 0 ? subscribedEvents : ALL_WEBHOOK_EVENTS;
  const currentEvent = availableEvents.includes(selectedEvent) ? selectedEvent : availableEvents[0]!;

  // Target URL validation status (evaluated before making any network request)
  const urlGuard = validateWebhookUrlWithReason(webhook.url);

  // Delivery preview data: prefer server response with real secret signature, fallback to deterministic local preview
  const preview: WebhookDeliveryPreview =
    serverPreview ?? buildWebhookPreview(webhook.url, "", currentEvent);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/webhooks"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            ← All webhooks
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <p className="font-mono text-sm text-gray-900 dark:text-white truncate">
              {webhook.url}
            </p>
            <CopyButton value={webhook.url} />
          </div>
        </div>
        <span
          className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
            webhook.isActive
              ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
              : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
          }`}
        >
          {webhook.isActive ? "Active" : "Paused"}
        </span>
      </div>

      {/* URL Guard Alert (if target is rejected) */}
      {!urlGuard.safe && (
        <div
          data-testid="url-guard-warning"
          className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-start gap-3"
        >
          <span className="text-amber-600 dark:text-amber-400 font-bold text-lg leading-none">⚠️</span>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Target URL Rejected by SSRF Guard
            </h3>
            <p className="text-xs text-amber-700 dark:text-amber-400 font-mono">
              {urlGuard.reason}
            </p>
            <p className="text-xs text-amber-600/90 dark:text-amber-500/90">
              Requests to internal, loopback, private networks, or malformed URLs are blocked before dispatch to prevent SSRF vulnerabilities.
            </p>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Configuration */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Configuration
          </h2>
          <div>
            <p className="text-xs text-gray-400 mb-1">Subscribed events</p>
            <div className="flex flex-wrap gap-1.5">
              {subscribedEvents.length > 0 ? (
                subscribedEvents.map((evt) => (
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
            <p className="text-xs text-gray-400 mb-1">Target security</p>
            <div className="flex items-center gap-2">
              <Badge variant={urlGuard.safe ? "success" : "danger"}>
                {urlGuard.safe ? "Public Safe Target" : "Blocked by URL Guard"}
              </Badge>
              {!urlGuard.safe && (
                <span className="text-xs text-amber-600 dark:text-amber-400 truncate max-w-xs">
                  {urlGuard.reason}
                </span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Signing secret</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {webhook.hasSecret
                ? "Configured — HMAC-SHA256 signature calculated on each delivery."
                : "Not configured."}
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

        {/* Send test event & Results */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Send Test Event
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Fires a sample event payload to your endpoint with valid HMAC signing. No real payment is
              created — all test events are clearly marked with <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded font-mono">test: true</code>.
            </p>
          </div>

          <div>
            <label
              htmlFor="test-event-select"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Simulate event
            </label>
            <select
              id="test-event-select"
              aria-label="Event type to test"
              value={currentEvent}
              onChange={(e) => setSelectedEvent(e.target.value as WebhookEventType)}
              className="w-full text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {availableEvents.map((evt) => (
                <option key={evt} value={evt}>
                  {evt} ({WEBHOOK_EVENT_LABELS[evt] ?? evt})
                </option>
              ))}
            </select>
          </div>

          <Button
            onClick={handleSendTest}
            disabled={sending || !webhook.isActive || !urlGuard.safe}
          >
            {sending ? "Sending…" : "Send test event"}
          </Button>

          {!webhook.isActive && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Resume this webhook to send a test event.
            </p>
          )}

          {!urlGuard.safe && (
            <p className="text-xs text-red-600 dark:text-red-400">
              Test sender disabled: target URL is rejected by SSRF guard ({urlGuard.reason}).
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
              className={`p-4 rounded-lg border space-y-3 ${
                result.delivered
                  ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                  : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
              }`}
            >
              <div className="flex items-center justify-between">
                <p
                  className={`text-sm font-semibold ${
                    result.delivered
                      ? "text-green-800 dark:text-green-300"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {result.delivered ? "Delivered" : "Failed"}
                </p>
                <div className="flex items-center gap-2">
                  {result.statusCode && (
                    <Badge variant={result.delivered ? "success" : "danger"}>
                      HTTP {result.statusCode}
                    </Badge>
                  )}
                  <Badge variant={result.delivered ? "success" : "danger"}>
                    {result.status}
                  </Badge>
                </div>
              </div>

              <dl className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
                <div className="flex justify-between">
                  <dt className="text-gray-400">Event</dt>
                  <dd className="font-mono">{result.event}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Latency</dt>
                  <dd className="font-mono">{result.latencyMs ?? result.durationMs} ms</dd>
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

              {result.responseBody ? (
                <div className="pt-2 border-t border-gray-200/60 dark:border-gray-700/60">
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Response body excerpt
                  </dt>
                  <pre
                    data-testid="response-body"
                    className="p-2.5 text-xs bg-black/5 dark:bg-black/40 rounded font-mono overflow-x-auto max-h-32 text-gray-800 dark:text-gray-200"
                  >
                    {result.responseBody}
                  </pre>
                </div>
              ) : null}

              <div className="pt-2 border-t border-gray-200/60 dark:border-gray-700/60 flex items-center justify-between text-xs">
                {result.deliveryId ? (
                  <span className="text-gray-400 truncate">
                    Delivery ID: <span className="font-mono">{result.deliveryId.slice(0, 12)}…</span>
                  </span>
                ) : (
                  <span />
                )}
                <Link
                  href={
                    result.deliveryId
                      ? `/webhooks?expanded=${webhook.id}#delivery-${result.deliveryId}`
                      : `/webhooks?expanded=${webhook.id}`
                  }
                  data-testid="delivery-record-link"
                  className="font-medium text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
                >
                  View full delivery record →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delivery Preview Panel */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Delivery Preview
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Inspect the exact outgoing payload, canonicalized signature scheme, and HTTP headers before sending.
            </p>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-0.5 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => setPreviewTab("wire")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                previewTab === "wire"
                  ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Wire Body (Byte-for-Byte)
            </button>
            <button
              type="button"
              onClick={() => setPreviewTab("canonical")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                previewTab === "canonical"
                  ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Canonical Payload
            </button>
            <button
              type="button"
              onClick={() => setPreviewTab("headers")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                previewTab === "headers"
                  ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              HTTP Headers
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {previewTab === "wire" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>
                Exact JSON payload transmitted on the wire, including the calculated HMAC signature.
              </span>
              <CopyButton value={preview.outgoingBody} />
            </div>
            <pre className="text-xs bg-gray-900 text-green-400 rounded-lg p-4 overflow-x-auto font-mono whitespace-pre-wrap">
              {JSON.stringify(JSON.parse(preview.outgoingBody), null, 2)}
            </pre>
          </div>
        )}

        {previewTab === "canonical" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>
                Canonical payload with emptied signature (<code className="font-mono">signature: &quot;&quot;</code>). HMAC-SHA256 is computed over this exact string.
              </span>
              <CopyButton value={preview.canonicalJson} />
            </div>
            <pre className="text-xs bg-gray-900 text-amber-300 rounded-lg p-4 overflow-x-auto font-mono whitespace-pre-wrap">
              {preview.canonicalJson}
            </pre>
          </div>
        )}

        {previewTab === "headers" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>HTTP request headers sent with the webhook POST request:</span>
              <CopyButton value={JSON.stringify(preview.headers, null, 2)} />
            </div>
            <div className="bg-gray-900 rounded-lg p-4 font-mono text-xs text-gray-200 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-800 pb-2">
                <span className="text-gray-400 font-semibold">Content-Type</span>
                <span className="text-sky-300">{preview.headers["Content-Type"]}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-800 pb-2">
                <span className="text-gray-400 font-semibold">X-OphirPay-Event</span>
                <span className="text-amber-300">{preview.headers["X-OphirPay-Event"]}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pt-1">
                <span className="text-gray-400 font-semibold shrink-0">X-OphirPay-Signature</span>
                <span className="text-green-400 break-all text-right font-mono">
                  {preview.headers["X-OphirPay-Signature"] || "(generated with webhook secret)"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Deliveries History */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Recent Deliveries
          </h2>
          <Link
            href={`/webhooks?expanded=${webhook.id}`}
            className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
          >
            Manage in All Webhooks →
          </Link>
        </div>

        {deliveriesLoading ? (
          <p className="text-xs text-gray-400">Loading delivery history…</p>
        ) : deliveries.length === 0 ? (
          <p className="text-xs text-gray-400">No deliveries recorded yet. Send a test event above to verify.</p>
        ) : (
          <div className="space-y-2">
            {deliveries.map((d) => (
              <div
                key={d.id}
                id={`delivery-${d.id}`}
                className="flex items-center justify-between gap-3 text-xs bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2.5"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-mono text-gray-800 dark:text-gray-200 font-medium">
                    {d.eventType}
                  </span>
                  {d.isReplay && (
                    <Badge variant="info">replay</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0 text-gray-400">
                  <span
                    className={
                      d.status === "SUCCESS"
                        ? "text-green-600 dark:text-green-400 font-medium"
                        : "text-red-600 dark:text-red-400 font-medium"
                    }
                  >
                    {d.status}
                    {d.responseCode != null ? ` (${d.responseCode})` : ""}
                  </span>
                  <span>
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
    </div>
  );
}
