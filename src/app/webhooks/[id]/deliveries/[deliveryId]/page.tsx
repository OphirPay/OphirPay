"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useApiQuery } from "@/hooks/useApiQuery";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyState } from "@/components/EmptyState";

interface DeliveryData {
  id: string;
  webhookId: string;
  event: string;
  targetUrl: string;
  canonicalBody: string | null;
  requestBody: string | null;
  signature: string | null;
  requestHeaders: string | null;
  test: boolean;
  status: number | null;
  responseBody: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

export default function WebhookDeliveryPage() {
  const params = useParams<{ id: string; deliveryId: string }>();
  const router = useRouter();
  const id = params?.id as string;
  const deliveryId = params?.deliveryId as string;
  const { data: delivery, isLoading } = useApiQuery<DeliveryData>(
    ["webhook-delivery", id, deliveryId],
    `/api/webhooks/${id}/deliveries/${deliveryId}`,
  );

  if (isLoading) {
    return <div className="h-64 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />;
  }

  if (!delivery) {
    return (
      <EmptyState
        icon={<span className="text-2xl">!</span>}
        title="Delivery Not Found"
        description="This delivery doesn't exist or doesn't belong to your account."
        actionLabel="Back to webhook"
        onAction={() => router.push(`/webhooks/${id}`)}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <Link
          href={`/webhooks/${id}`}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          ← Back to webhook
        </Link>
        <div className="flex items-center gap-2 mt-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Webhook delivery</h1>
          {delivery.test && <Badge variant="info">Test event</Badge>}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-xs text-gray-400">Response status</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white mt-1">
            {delivery.status ?? "No response"}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-xs text-gray-400">Latency</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white mt-1">
            {delivery.durationMs == null ? "—" : `${delivery.durationMs} ms`}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-xs text-gray-400">Event</p>
          <p className="text-lg font-semibold font-mono text-gray-900 dark:text-white mt-1">
            {delivery.event}
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div>
          <p className="text-xs text-gray-400">Target URL</p>
          <div className="flex items-center gap-2 mt-1">
            <p className="font-mono text-sm text-gray-900 dark:text-white break-all">{delivery.targetUrl}</p>
            <CopyButton value={delivery.targetUrl} />
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Sent at</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {new Date(delivery.createdAt).toLocaleString()}
          </p>
        </div>
        {delivery.error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{delivery.error}</p>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1"><h2 className="text-sm font-semibold text-gray-900 dark:text-white">Canonical signing input</h2><CopyButton value={delivery.canonicalBody ?? ""} /></div>
          <pre className="text-xs bg-gray-900 text-yellow-300 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">{delivery.canonicalBody || "(not recorded)"}</pre>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1"><h2 className="text-sm font-semibold text-gray-900 dark:text-white">Exact request body</h2><CopyButton value={delivery.requestBody ?? ""} /></div>
          <pre className="text-xs bg-gray-900 text-green-400 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">{delivery.requestBody || "(not recorded)"}</pre>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Request headers</h2>
          <pre className="text-xs bg-gray-900 text-blue-300 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">{delivery.requestHeaders || "(not recorded)"}</pre>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Response body</h2>
        <pre className="text-xs bg-gray-900 text-green-400 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">
          {delivery.responseBody || "(empty response body)"}
        </pre>
      </div>
    </div>
  );
}
