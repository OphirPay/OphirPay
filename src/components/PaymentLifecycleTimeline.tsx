"use client";
// SPDX-License-Identifier: MIT

import type { Payment } from "@/types";
import {
  derivePaymentTimeline,
  extractAuditEvents,
  type TimelineStep,
  type StepState,
} from "@/lib/payment-timeline";
import { formatDate, shortenAddress } from "@/lib/utils";
import { CopyButton } from "@/components/ui/CopyButton";

interface PaymentLifecycleTimelineProps {
  payment: Payment;
  className?: string;
}

export function PaymentLifecycleTimeline({
  payment,
  className = "",
}: PaymentLifecycleTimelineProps) {
  const steps = derivePaymentTimeline(payment);
  const auditEvents = extractAuditEvents(payment);

  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-6 ${className}`}
      data-testid="payment-lifecycle-timeline"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Lifecycle Timeline
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            End-to-end payment status and on-chain verification sequence
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Phase:</span>
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
              payment.status === "COMPLETED" || payment.status === "CONFIRMED"
                ? "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300"
                : payment.status === "FAILED"
                ? "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300"
                : payment.status === "CANCELLED"
                ? "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300"
                : "bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300"
            }`}
            data-testid="timeline-status-badge"
          >
            {payment.status === "COMPLETED" || payment.status === "CONFIRMED"
              ? "Settled"
              : payment.status === "FAILED"
              ? "Failed"
              : payment.status === "CANCELLED"
              ? "Cancelled"
              : "In Flight"}
          </span>
        </div>
      </div>

      {/* Stepper Timeline */}
      <ol
        className="relative grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-4"
        aria-label="Payment lifecycle timeline"
      >
        {steps.map((step, idx) => (
          <TimelineStepItem
            key={`${step.stage}-${idx}`}
            step={step}
            index={idx}
            isLast={idx === steps.length - 1}
          />
        ))}
      </ol>

      {/* Optional Audit and Event Log Trail */}
      {auditEvents.length > 0 && (
        <div
          className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800"
          data-testid="audit-log-section"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
            Audit & Event Log Evidence
          </h3>
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 space-y-2">
            {auditEvents.map((evt, idx) => (
              <div
                key={idx}
                className="flex items-start justify-between gap-2 text-xs text-gray-600 dark:text-gray-300 font-mono"
              >
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  <span className="font-semibold text-gray-800 dark:text-gray-200">
                    {evt.type || evt.kind || evt.action || "Event"}
                  </span>
                  {evt.note && <span className="text-gray-500">({evt.note})</span>}
                  {evt.details && (
                    <span className="text-gray-500">— {evt.details}</span>
                  )}
                </div>
                {evt.timestamp && (
                  <span className="text-gray-400 shrink-0">
                    {formatDate(evt.timestamp)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineStepItem({
  step,
  index,
  isLast,
}: {
  step: TimelineStep;
  index: number;
  isLast: boolean;
}) {
  const { icon, iconBg, badgeBg, badgeText } = getStepStyles(step.state);

  return (
    <li
      className="relative flex flex-col space-y-2 group"
      data-testid={`timeline-step-${step.stage}`}
    >
      {/* Connecting line for desktop */}
      {!isLast && (
        <div
          className={`hidden md:block absolute top-4 left-8 right-0 h-0.5 -z-0 ${
            step.state === "completed"
              ? "bg-green-500 dark:bg-green-600"
              : "bg-gray-200 dark:bg-gray-700"
          }`}
          aria-hidden="true"
        />
      )}

      {/* Step Header with Icon and Stage */}
      <div className="flex items-center gap-3">
        <div
          className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full font-bold text-xs border transition-colors shadow-sm ${iconBg}`}
          aria-hidden="true"
        >
          {icon}
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {step.title}
            </span>
            <span
              className={`text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded ${badgeBg} ${badgeText}`}
            >
              {step.state}
            </span>
          </div>
          <span className="text-xs text-gray-400">Step {index + 1}</span>
        </div>
      </div>

      {/* Step Content */}
      <div className="ml-11 md:ml-0 md:mt-2 space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
        <p className="leading-snug">{step.description}</p>

        {/* Timestamp */}
        {step.timestamp && (
          <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 font-mono text-[11px]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-3.5 h-3.5 opacity-70 shrink-0"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{formatDate(step.timestamp)}</span>
          </div>
        )}

        {/* Explorer Link if txHash present */}
        {step.txHash && step.explorerUrl && (
          <div className="flex items-center gap-1.5 pt-1">
            <a
              href={step.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-ophir-600 dark:text-ophir-400 hover:underline font-mono text-[11px] font-medium"
              title="View transaction on Stellar Explorer"
            >
              <span>{shortenAddress(step.txHash, 6)}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-3 h-3 opacity-70"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </a>
            <CopyButton value={step.txHash} label="Hash" />
          </div>
        )}

        {/* Error message callout for failed stage */}
        {step.errorMessage && (
          <div
            className="p-2 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-[11px] leading-tight"
            data-testid="timeline-error-box"
          >
            <strong>Error:</strong> {step.errorMessage}
          </div>
        )}
      </div>
    </li>
  );
}

function getStepStyles(state: StepState) {
  switch (state) {
    case "completed":
      return {
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4 text-green-600 dark:text-green-400"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ),
        iconBg:
          "bg-green-50 dark:bg-green-950/50 border-green-500 text-green-700",
        badgeBg: "bg-green-100 dark:bg-green-900/40",
        badgeText: "text-green-800 dark:text-green-300",
      };
    case "active":
      return {
        icon: (
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-600" />
          </span>
        ),
        iconBg:
          "bg-blue-50 dark:bg-blue-950/50 border-blue-500 text-blue-700 ring-2 ring-blue-400/30",
        badgeBg: "bg-blue-100 dark:bg-blue-900/40",
        badgeText: "text-blue-800 dark:text-blue-300",
      };
    case "failed":
      return {
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4 text-red-600 dark:text-red-400"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        ),
        iconBg: "bg-red-50 dark:bg-red-950/50 border-red-500 text-red-700",
        badgeBg: "bg-red-100 dark:bg-red-900/40",
        badgeText: "text-red-800 dark:text-red-300",
      };
    case "cancelled":
      return {
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4 text-gray-500 dark:text-gray-400"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
              clipRule="evenodd"
            />
          </svg>
        ),
        iconBg: "bg-gray-100 dark:bg-gray-800 border-gray-400 text-gray-600",
        badgeBg: "bg-gray-100 dark:bg-gray-800",
        badgeText: "text-gray-700 dark:text-gray-300",
      };
    case "upcoming":
    default:
      return {
        icon: (
          <span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />
        ),
        iconBg:
          "bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-400",
        badgeBg: "bg-gray-100 dark:bg-gray-800",
        badgeText: "text-gray-500 dark:text-gray-400",
      };
  }
}
