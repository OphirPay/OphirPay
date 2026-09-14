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

  const { data: rawWebhooks, isLoading } = useApiQuery<WebhookData[]>(
    ["webhooks"],
    "/api/webhooks",
  );
  const webhooks = Array.isArray(rawWebhooks) ? rawWebhooks : [];
  const webhook = webhooks.find((w) => w.id === id);

  const testMutation = useApiMutation<undefined, TestResult>(
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
