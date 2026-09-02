"use client";
// SPDX-License-Identifier: MIT

// The Contracts route is code-split behind next/dynamic so the heavy Soroban
// interaction code (and the wallet/contracts client modules it pulls in) is
// only downloaded when the route is actually opened. A card skeleton keeps the
// layout height stable while it loads — no layout shift.

import dynamic from "next/dynamic";
import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

const ContractsExplorer = dynamic(
  () =>
    import("@/components/contracts/ContractsExplorer").then(
      (mod) => mod.ContractsExplorer
    ),
  {
    ssr: false,
    loading: () => (
      <>
        <div className="flex items-center justify-between">
          <LoadingSkeleton lines={2} className="w-64" />
        </div>
        <LoadingSkeleton variant="card" lines={3} />
        <LoadingSkeleton variant="card" lines={4} />
      </>
    ),
  }
);

export default function ContractsPage() {
  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <div className="space-y-2">
        <Breadcrumb items={[{ label: "Contracts" }]} />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Soroban Contracts
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          Interact with the OphirPay smart contract on Stellar Testnet
        </p>
      </div>
      <ContractsExplorer />
    </div>
  );
}