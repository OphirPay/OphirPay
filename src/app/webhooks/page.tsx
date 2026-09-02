"use client";
// SPDX-License-Identifier: MIT


import { useState } from "react";
import Link from "next/link";

import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import { useApiQuery, useApiMutation, type ApiError } from "@/hooks/useApiQuery";
import { ALL_WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS } from "@/app/api/webhooks/event-types";
import type { WebhookEventType } from "@/app/api/webhooks/event-types";

interface WebhookData {
  id: string;
  url: string;
  events: string;
  isActive: boolean;
  hasSecret: boolean;
  createdAt: string;
}

interface WebhookDeliveryData {
  id: string;
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  status: string;
  responseCode: number | null;
  isReplay: boolean;
  replayBatchId: string | null;
  deliveredAt: string;
}

interface ReplayResult {
  replayBatchId: string;
  selected: number;
  succeeded: number;
  failed: number;
  window: { since: string; until: string; maxDays: number };
}

interface CreateWebhookBody {
  url: string;
  events: WebhookEventType[];
  isActive: boolean;
}

export default function WebhooksPage() {
  usePageTitle(PAGE_TITLES.WEBHOOKS);
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replaying, setReplaying] = useState<string | null>(null);

  // Webhook secret rotation
  const [rotateTarget, setRotateTarget] = useState<WebhookData | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  const [formUrl, setFormUrl] = useState("");
  const [formEvents, setFormEvents] = useState<WebhookEventType[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data: rawWebhooks,
    isLoading: loading,
  } = useApiQuery<WebhookData[]>(["webhooks"], "/api/webhooks");
  const webhooks = Array.isArray(rawWebhooks) ? rawWebhooks : [];

  const createMutation = useApiMutation<CreateWebhookBody, WebhookData & { secret?: string }>(
    "/api/webhooks",
    { invalidateKeys: [["webhooks"]] }
  );

  const deleteMutation = useApiMutation<{ id: string }, { deleted: boolean }>(
    (body) => `/api/webhooks?id=${body.id}`,
    { method: "DELETE", invalidateKeys: [["webhooks"]] }
  );

  const replayMutation = useApiMutation<{ webhookId: string }, ReplayResult>(
    (body) => `/api/webhooks/${body.webhookId}/replay`,
    { invalidateKeys: [["webhook-deliveries"]] }
  );

  const {
    data: rawDeliveries,
    isLoading: deliveriesLoading,
  } = useApiQuery<WebhookDeliveryData[]>(
    ["webhook-deliveries", expandedId ?? ""],
    expandedId ? `/api/webhooks/${expandedId}/deliveries?limit=20` : "",
    { enabled: !!expandedId }
  );
  const deliveries = Array.isArray(rawDeliveries) ? rawDeliveries : [];

  const toggleEvent = (event: WebhookEventType) => {
    setFormEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const handleCreate = async () => {
    setFormError(null);
    if (!formUrl) {
      setFormError("Webhook URL is required.");
      return;
    }
    

    setSubmitting(true);
    try {
      const data = await createMutation.mutateAsync({
        url: formUrl,
        events: formEvents,
        isActive: true,
      });
      setNewSecret(data?.secret ?? null);
      setFormUrl("");
      setFormEvents([]);
      toast.success("Webhook created", "Your webhook endpoint has been registered.");
    } catch (err) {
      const apiErr = err as ApiError;
      setFormError(apiErr.message || "Failed to create webhook");
    } finally {
      setSubmitting(false);
    }
  };

  const startRotate = (wh: WebhookData) => {
    setRotateTarget(wh);
    setRotatedSecret(null);
    setRotateError(null);
  };

  const confirmRotate = async () => {
    if (!rotateTarget) return;
    setRotating(true);
    setRotateError(null);
    try {
      const data = await rotateMutation.mutateAsync({ id: rotateTarget.id });
      setRotatedSecret(data?.secret ?? null);
      toast.success("Webhook secret rotated", "The old secret is now revoked.");
    } catch (err) {
      const apiErr = err as ApiError;
      setRotateError(apiErr.message || "Failed to rotate secret");
    } finally {
      setRotating(false);
    }
  };

  const closeRotate = () => {
    setRotateTarget(null);
    setRotatedSecret(null);
    setRotateError(null);
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success("Webhook deleted");
      if (expandedId === id) setExpandedId(null);
    } catch (err) {
      const apiErr = err as ApiError;
      toast.error(apiErr.message || "Failed to delete webhook");
    } finally {
      setDeleting(null);
    }
  };

  const handleReplay = async (webhookId: string) => {
    setReplaying(webhookId);
    try {
      const result = await replayMutation.mutateAsync({ webhookId });
      toast.success(
        "Replay complete",
        `${result.succeeded} succeeded, ${result.failed} failed (${result.selected} events)`
      );
      setExpandedId(webhookId);
    } catch (err) {
      const apiErr = err as ApiError;
      toast.error(apiErr.message || "Failed to replay events");
    } finally {
      setReplaying(null);
    }
  };

  const resetForm = () => {
    setShowCreate(false);
    setNewSecret(null);
    setFormError(null);
    setFormUrl("");
    setFormEvents([]);
  };

  const parseEvents = (events: string): WebhookEventType[] => {
    try {
      return JSON.parse(events) as WebhookEventType[];
    } catch {
      return [];
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <div className="h-8 w-40 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
          <div className="h-4 w-72 bg-gray-200 dark:bg-gray-800 rounded animate-pulse mt-2" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Webhooks</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {webhooks.length > 0
              ? `${webhooks.length} endpoint${webhooks.length !== 1 ? "s" : ""} configured`
              : "Configure webhook endpoints for real-time payment event notifications"}
          </p>
        </div>
        {webhooks.length > 0 && (
          <Button onClick={() => setShowCreate(true)}>Add Webhook</Button>
        )}
      </div>

      {webhooks.length === 0 ? (
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
          title="No Webhooks Yet"
          description="Set up webhooks to receive real-time notifications for payment events like completions and failures."
          actionLabel="Add Webhook"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <>
          <div className="space-y-3">
            {webhooks.map((wh) => {
              const events = parseEvents(wh.events);
              return (
                <div
                  key={wh.id}
                  className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <p className="font-mono text-sm text-gray-900 dark:text-white truncate">
                          {wh.url}
                        </p>
                        <CopyButton value={wh.url} />
                      </div>
                       <div className="flex flex-wrap gap-1.5 mb-2">
                        {events.length === 0 ? (
                          <Badge variant="info">All events</Badge>
                        ) : (
                          events.map((evt) => (
                            <Badge key={evt} variant="info">
                              {WEBHOOK_EVENT_LABELS[evt] ?? evt}
                            </Badge>
                          ))
                        )}
                       </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>
                          Created{" "}
                          {new Date(wh.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                        <span className="flex items-center gap-1">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              wh.isActive ? "bg-green-500" : "bg-gray-400"
                            }`}
                          />
                          {wh.isActive ? "Active" : "Paused"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setExpandedId(expandedId === wh.id ? null : wh.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 transition-colors"
                      >
                        {expandedId === wh.id ? "Hide" : "Deliveries"}
                      </button>
                      <button
                        onClick={() => handleReplay(wh.id)}
                        disabled={replaying === wh.id || !wh.isActive}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-ophir-700 dark:text-ophir-300 hover:bg-ophir-50 dark:hover:bg-ophir-950/30 border border-ophir-200 dark:border-ophir-800 transition-colors disabled:opacity-50"
                      >
                        {replaying === wh.id ? "Replaying..." : "Replay"}
                      </button>
                      <button
                        onClick={() => handleDelete(wh.id)}
                        disabled={deleting === wh.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 border border-red-200 dark:border-red-800 transition-colors disabled:opacity-50"
                      >
                        {deleting === wh.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                     <div className="flex items-center gap-2 shrink-0">
                       <Link
                         href={`/webhooks/${wh.id}`}
                         className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 transition-colors"
                       >
                         View
                       </Link>
                       <button
                         onClick={() => handleDelete(wh.id)}
                         disabled={deleting === wh.id}
                         className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 border border-red-200 dark:border-red-800 transition-colors disabled:opacity-50"
                       >
                         {deleting === wh.id ? "Deleting..." : "Delete"}
                       </button>
                     </div>
                  </div>
                  {expandedId === wh.id && (
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                        Recent Deliveries
                      </h4>
                      {deliveriesLoading ? (
                        <p className="text-xs text-gray-400">Loading deliveries...</p>
                      ) : deliveries.length === 0 ? (
                        <p className="text-xs text-gray-400">No deliveries recorded yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {deliveries.map((d) => (
                            <div
                              key={d.id}
                              className="flex items-center justify-between gap-3 text-xs bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2"
                            >
                              <div className="min-w-0">
                                <span className="font-mono text-gray-700 dark:text-gray-300">
                                  {d.eventType}
                                </span>
                                {d.isReplay && (
                                  <Badge variant="info" className="ml-2">
                                    replay
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 shrink-0 text-gray-400">
                                <span
                                  className={
                                    d.status === "SUCCESS"
                                      ? "text-green-600 dark:text-green-400"
                                      : "text-red-600 dark:text-red-400"
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
                  )}
                </div>
              );
            })}
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">
              Webhook Delivery
            </h3>
            <p className="text-xs text-blue-700 dark:text-blue-400 mb-3">
              Webhooks are delivered with HMAC-SHA256 signatures. Verify the{" "}
              <code className="px-1 py-0.5 bg-blue-100 dark:bg-blue-900/50 rounded text-xs">
                X-OphirPay-Signature
              </code>{" "}
              header using your webhook secret. Failed deliveries are retried up to 3
              times with exponential backoff (1s, 2s, 4s).
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-500">
              Expected payload:{" "}
              <code className="px-1 py-0.5 bg-blue-100 dark:bg-blue-900/50 rounded text-xs">
                {`{ event, timestamp, data, signature }`}
              </code>
            </p>
          </div>
        </>
      )}

      {/* Create / Success Modal */}
      <Modal
        open={showCreate}
        onClose={resetForm}
        title={newSecret ? "Webhook Created!" : "Add Webhook Endpoint"}
        description={
          newSecret
            ? "Save your signing secret — it won't be shown again."
            : "Webhooks receive real-time payment event notifications via HTTP POST."
        }
        size="md"
        footer={
          newSecret ? (
            <button
              onClick={resetForm}
              className="px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={resetForm}
                disabled={submitting}
                className="px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting}
                className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-ophir-600 to-stellar-dark text-white text-sm font-medium hover:from-ophir-700 hover:to-stellar transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Creating...
                  </>
                ) : (
                  "Create Webhook"
                )}
              </button>
            </>
          )
        }
      >
        {newSecret ? (
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
              <p className="text-sm text-green-800 dark:text-green-300 mb-2 font-medium">
                Your webhook signing secret
              </p>
              <p className="text-xs text-green-700 dark:text-green-400 mb-3">
                Save this secret now — it won&apos;t be shown again. Use it to verify
                the HMAC-SHA256 signature on incoming webhooks.
              </p>
              <div className="flex items-center gap-2 bg-green-100 dark:bg-green-900/30 rounded-lg p-3">
                <code className="text-xs font-mono text-green-900 dark:text-green-200 break-all flex-1">
                  {newSecret}
                </code>
                <CopyButton value={newSecret} />
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                Verify your endpoint with curl:
              </p>
              <pre className="text-xs bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto">
{`curl -X POST <your-endpoint> \\
  -H "Content-Type: application/json" \\
  -H "X-OphirPay-Event: payment.created" \\
  -H "X-OphirPay-Signature: <signature>" \\
  -d '{"event":"payment.created","timestamp":"...","data":{}}'`}
              </pre>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Endpoint URL
              </label>
              <input
                type="url"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://your-server.com/webhooks/ophirpay"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Event Types
              </label>
                            <div className="grid grid-cols-2 gap-2">
                {ALL_WEBHOOK_EVENTS.map((evt) => (
                  <label
                    key={evt}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                      formEvents.includes(evt)
                        ? "bg-ophir-50 dark:bg-ophir-950/30 border-ophir-300 dark:border-ophir-700 text-ophir-700 dark:text-ophir-300 ring-1 ring-ophir-500"
                        : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formEvents.includes(evt)}
                      onChange={() => toggleEvent(evt)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-ophir-600 focus:ring-ophir-500"
                    />
                    {WEBHOOK_EVENT_LABELS[evt]}
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                {formEvents.length > 0
                  ? `${formEvents.length} event${formEvents.length !== 1 ? "s" : ""} selected`
                  : "No events selected — this webhook will receive all events."}
              </p>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Rotate Secret Modal — confirm warning, then show the new secret once */}
      <Modal
        open={rotateTarget !== null}
        onClose={closeRotate}
        title={rotatedSecret ? "Secret Rotated" : "Rotate Webhook Secret?"}
        description={
          rotatedSecret
            ? "Save your new signing secret — it won't be shown again."
            : "This will invalidate the current signing secret."
        }
        size="md"
        footer={
          rotatedSecret ? (
            <button
              onClick={closeRotate}
              className="px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={closeRotate}
                disabled={rotating}
                className="px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmRotate}
                disabled={rotating}
                className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {rotating ? "Rotating..." : "Confirm Rotation"}
              </button>
            </>
          )
        }
      >
        {rotatedSecret ? (
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
              <p className="text-sm text-green-800 dark:text-green-300 mb-2 font-medium">
                Your new webhook signing secret
              </p>
              <p className="text-xs text-green-700 dark:text-green-400 mb-3">
                Save this secret now — it won&apos;t be shown again. The previous
                secret was revoked immediately.
              </p>
              <div className="flex items-center gap-2 bg-green-100 dark:bg-green-900/30 rounded-lg p-3">
                <code className="text-xs font-mono text-green-900 dark:text-green-200 break-all flex-1">
                  {rotatedSecret}
                </code>
                <CopyButton value={rotatedSecret} label="Secret" />
              </div>
            </div>
            {rotateTarget && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                  Endpoint
                </p>
                <p className="text-xs font-mono text-gray-800 dark:text-gray-200 break-all">
                  {rotateTarget.url}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
              <p className="text-sm text-amber-800 dark:text-amber-300 font-medium mb-1">
                ⚠️ Integrator impact
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Rotating revokes the current HMAC secret{" "}
                <strong>immediately</strong>. Any integrator still verifying
                signatures with the old secret will stop receiving valid
                webhooks until they update their endpoint configuration with
                the new secret.
              </p>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              You&apos;ll see the new secret exactly once after rotating — make
              sure you can save it.
            </p>
            {rotateError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">
                  {rotateError}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
