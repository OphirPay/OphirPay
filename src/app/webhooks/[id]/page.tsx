"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { useApiQuery, useApiMutation, type ApiError } from "@/hooks/useApiQuery";
import {
  ALL_WEBHOOK_EVENTS,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  type WebhookEventType,
} from "@/app/api/webhooks/event-types";

interface WebhookData {
  id: string;
  url: string;
  events: string;
  isActive: boolean;
  hasSecret: boolean;
  createdAt: string;
}

interface RequestPreview {
  canonicalBody: string;
  body: string;
  signature: string;
  headers: Record<string, string>;
}

interface PreviewData {
  targetUrl: string;
  event: string;
  timestamp: string;
  preview: RequestPreview;
}

interface TestResult {
  delivered: boolean;
  status: "delivered" | "failed";
  event: string;
  test: boolean;
  durationMs: number;
  sentAt: string;
  responseStatus: number | null;
  responseBodyExcerpt: string;
  deliveryId: string;
  targetUrl?: string;
  preview?: RequestPreview;
}

export default function WebhookDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const id = params?.id as string;

  const [event, setEvent] = useState<WebhookEventType>(WEBHOOK_EVENTS.PAYMENT_COMPLETED);
  const [previewTimestamp, setPreviewTimestamp] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const { data: rawWebhooks, isLoading } = useApiQuery<WebhookData[]>(
    ["webhooks"],
    "/api/webhooks",
  );
  const webhooks = Array.isArray(rawWebhooks) ? rawWebhooks : [];
  const webhook = webhooks.find((w) => w.id === id);

  useEffect(() => {
    setPreviewTimestamp(new Date().toISOString());
  }, []);

  const previewTime = previewTimestamp ?? "";
  const previewQuery = useApiQuery<PreviewData>(
    ["webhook-test-preview", id, event, previewTime],
    previewTime
      ? `/api/webhooks/${id}/test?event=${encodeURIComponent(event)}&timestamp=${encodeURIComponent(previewTime)}`
      : undefined,
    { enabled: Boolean(previewTime) },
  );

  const testMutation = useApiMutation<{ event: WebhookEventType; timestamp?: string }, TestResult>(
    `/api/webhooks/${id}/test`,
  );

  const parseEvents = (events: string): WebhookEventType[] => {
    try {
      return JSON.parse(events) as WebhookEventType[];
    } catch {
      return [];
    }
  };

  const handleSendTest = async () => {
    setSendError(null);
    if (previewQuery.error) {
      setSendError(previewQuery.error.message || "The webhook target was rejected by the URL guard.");
      return;
    }
    if (!previewQuery.data) {
      setSendError("Wait for the request preview to finish loading before sending.");
      return;
    }

    setSending(true);
    setResult(null);
    try {
      const res = await testMutation.mutateAsync({ event, timestamp: previewTimestamp ?? undefined });
      setResult(res);
      if (res.delivered) {
        toast.success("Test event delivered", `Accepted by your endpoint in ${res.durationMs}ms.`);
      } else {
        toast.error("Test event failed", "Your endpoint did not return a 2xx response.");
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setSendError(apiErr.message || "Failed to send test event");
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
              d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757 1.757a4.5 4.5 0 01-6.364 6.364l-1.757-1.757"
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
  const preview = previewQuery.data?.preview;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/webhooks"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            ← All webhooks
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <p className="font-mono text-sm text-gray-900 dark:text-white truncate">{webhook.url}</p>
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

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Configuration</h2>
          <div>
            <p className="text-xs text-gray-400 mb-1">Subscribed events</p>
            <div className="flex flex-wrap gap-1.5">
              {events.length > 0 ? (
                events.map((evt) => (
                  <Badge key={evt} variant="info">{WEBHOOK_EVENT_LABELS[evt] ?? evt}</Badge>
                ))
              ) : (
                <span className="text-xs text-gray-400">None</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Signing secret</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {webhook.hasSecret ? "Configured — used to sign test and live events." : "Not configured."}
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

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Send Test Event</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Send a clearly marked test event and inspect the exact request before delivery.
            </p>
          </div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            Event
            <select
              value={event}
              onChange={(e) => setEvent(e.target.value as WebhookEventType)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
            >
              {ALL_WEBHOOK_EVENTS.map((evt) => (
                <option key={evt} value={evt}>{WEBHOOK_EVENT_LABELS[evt]}</option>
              ))}
            </select>
          </label>
          <Button onClick={handleSendTest} disabled={sending || !webhook.isActive || previewQuery.isFetching}>
            {sending ? "Sending…" : "Send test event"}
          </Button>
          {!webhook.isActive && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Resume this webhook to send a test event.</p>
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
              <div className="flex items-center justify-between gap-3">
                <p className={`text-sm font-medium ${result.delivered ? "text-green-800 dark:text-green-300" : "text-red-600 dark:text-red-400"}`}>
                  {result.delivered ? "Delivered" : "Failed"}
                </p>
                <Badge variant={result.delivered ? "success" : "danger"}>{result.responseStatus ?? result.status}</Badge>
              </div>
              <dl className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                <div className="flex justify-between gap-3"><dt className="text-gray-400">Event</dt><dd className="font-mono">{result.event}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-gray-400">Latency</dt><dd>{result.durationMs} ms</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-gray-400">Test markers</dt><dd className="font-mono">test: true</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-gray-400">Response body</dt><dd className="text-right break-all">{result.responseBodyExcerpt || "(empty)"}</dd></div>
              </dl>
              {result.deliveryId && (
                <Link href={`/webhooks/${id}/deliveries/${result.deliveryId}`} className="inline-flex mt-3 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
                  View full delivery record →
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Request preview</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              These are the exact bytes prepared for the next test delivery. The signature is calculated over the canonical body with an empty signature field.
            </p>
          </div>
          {previewQuery.isFetching && <span className="text-xs text-gray-400">Loading…</span>}
        </div>
        {previewQuery.error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{previewQuery.error.message}</p>
            <p className="text-xs text-red-500 dark:text-red-400 mt-1">No request was sent.</p>
          </div>
        )}
        {preview && previewQuery.data && (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-400 mb-1">Target URL after URL-guard validation</p>
              <div className="flex items-center gap-2"><p className="font-mono text-xs text-gray-900 dark:text-white break-all">{previewQuery.data.targetUrl}</p><CopyButton value={previewQuery.data.targetUrl} /></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-gray-400">Canonical signing input (signature: &quot;&quot;)</p><CopyButton value={preview.canonicalBody} /></div>
              <pre className="text-xs bg-gray-900 text-yellow-300 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">{preview.canonicalBody}</pre>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-gray-400">Exact body sent over the wire</p><CopyButton value={preview.body} /></div>
              <pre className="text-xs bg-gray-900 text-green-400 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">{preview.body}</pre>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Headers</p>
              <pre className="text-xs bg-gray-900 text-blue-300 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">{Object.entries(preview.headers).map(([key, value]) => `${key}: ${value}`).join("\n")}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
