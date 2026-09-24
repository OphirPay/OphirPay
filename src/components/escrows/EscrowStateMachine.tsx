"use client";
// SPDX-License-Identifier: MIT

import { type EscrowRecord, getEscrowStatus } from "@/lib/escrows";
import { cn } from "@/lib/utils";

interface EscrowStateMachineProps {
  escrow: EscrowRecord;
  className?: string;
}

export function EscrowStateMachine({ escrow, className }: EscrowStateMachineProps) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const status = getEscrowStatus(escrow, nowSeconds);

  const steps = [
    {
      id: "deposit",
      title: "1. Funds Locked",
      desc: "Deposited into smart contract",
      done: true,
      active: status === "LOCKED",
    },
    {
      id: "condition",
      title: "2. Release Condition",
      desc:
        status === "RELEASED"
          ? "Released early by owner / arbiter"
          : status === "DUE_FOR_CLAIM" || status === "CLAIMED"
          ? "Deadline passed"
          : "Awaiting deadline or owner release",
      done: status !== "LOCKED",
      active: status === "DUE_FOR_CLAIM",
    },
    {
      id: "settlement",
      title: "3. Settled",
      desc:
        status === "CLAIMED"
          ? "Claimed by beneficiary"
          : status === "RELEASED"
          ? "Transferred to recipient"
          : "Pending release / claim",
      done: status === "RELEASED" || status === "CLAIMED",
      active: false,
    },
  ];

  return (
    <div className={cn("p-4 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3", className)}>
      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
        Escrow State Machine
      </span>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {steps.map((step, idx) => (
          <div
            key={step.id}
            className={cn(
              "p-3 rounded-lg border transition-all",
              step.done
                ? "bg-white dark:bg-gray-800 border-emerald-300 dark:border-emerald-800/80 shadow-sm"
                : step.active
                ? "bg-white dark:bg-gray-800 border-amber-300 dark:border-amber-800/80 shadow-sm ring-1 ring-amber-400 dark:ring-amber-600"
                : "bg-gray-100/60 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700/60 opacity-60"
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
                {step.title}
              </span>
              {step.done ? (
                <span className="h-4 w-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px]">
                  ✓
                </span>
              ) : step.active ? (
                <span className="h-4 w-4 rounded-full bg-amber-500 text-white flex items-center justify-center text-[10px] animate-pulse">
                  ●
                </span>
              ) : (
                <span className="h-4 w-4 rounded-full bg-gray-300 dark:bg-gray-600 text-transparent flex items-center justify-center text-[10px]">
                  ○
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {step.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
