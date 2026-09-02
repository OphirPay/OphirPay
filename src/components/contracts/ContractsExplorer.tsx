"use client";
// SPDX-License-Identifier: MIT

// Lazy-loaded Soroban contract explorer. Extracted from
// src/app/contracts/page.tsx so the heavy @/lib/contracts + wallet modules are
// only fetched when the Contracts route is actually opened, keeping the initial
// bundle lean. Rendered through next/dynamic with a card skeleton fallback.

import { useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { useWallet } from "@/hooks/useMultiWallet";
import { getWalletConnector } from "@/lib/wallets";
import {
  DEFAULT_CONTRACT_ID,
  simulateContractCall,
  invokeContractFunction,
  submitContractInvocation,
  classifyContractError,
  ContractErrorType,
  type SimulateResult,
  type InvokeResult,
} from "@/lib/contracts";
import { getStellarExplorerUrl, NETWORK_PASSPHRASE } from "@/lib/stellar";
import { shortenAddress } from "@/lib/utils";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────

type TxRecord = {
  txHash: string;
  functionName: string;
  status: "SUCCESS" | "FAILED";
  errorType?: ContractErrorType;
  timestamp: string;
};

const FUNCTIONS = [
  { name: "get_payment_count", label: "Get Payment Count", readOnly: true },
  { name: "get_owner", label: "Get Contract Owner", readOnly: true },
  { name: "get_payment", label: "Get Payment #1", args: "1", readOnly: true },
];

export function ContractsExplorer() {
  usePageTitle(PAGE_TITLES.CONTRACTS);
  const { wallet } = useWallet();

  const [contractId] = useState(DEFAULT_CONTRACT_ID);
  const [functionName, setFunctionName] = useState("get_payment_count");
  const selectedFn = FUNCTIONS.find((f) => f.name === functionName) || FUNCTIONS[0];
  const [isLoading, setIsLoading] = useState(false);
  const [simResult, setSimResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<ContractErrorType | null>(null);
  const [history, setHistory] = useState<TxRecord[]>([]);

  // ── Execute ───────────────────────────────────────────────

  const handleSimulate = async () => {
    if (!wallet.publicKey) return;
    setIsLoading(true);
    setError(null);
    setErrorType(null);
    setSimResult(null);

    try {
      const result = await simulateContractCall(
        contractId,
        functionName,
        wallet.publicKey
      );
      setSimResult(result);
    } catch (err) {
      const contractError = classifyContractError(err);
      setError(contractError.message);
      setErrorType(contractError.type);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInvoke = async () => {
    if (!wallet.publicKey) return;
    setIsLoading(true);
    setError(null);
    setErrorType(null);

    try {
      const txInfo: InvokeResult = await invokeContractFunction(
        contractId,
        functionName,
        wallet.publicKey
      );

      if (txInfo.status === "AWAITING_SIGNATURE" && txInfo.xdr) {
        if (!wallet.activeWalletId) {
          throw new Error("No wallet connected. Please connect a wallet first.");
        }

        const connector = getWalletConnector(wallet.activeWalletId);
        const signedXdr = await connector.signTransaction(txInfo.xdr, {
          network: "TESTNET",
          networkPassphrase: NETWORK_PASSPHRASE,
        });

        const submitResult = await submitContractInvocation(signedXdr);

        setHistory((prev) => [
          {
            txHash: submitResult.txHash,
            functionName,
            status: submitResult.status === "SUCCESS" ? "SUCCESS" : "FAILED",
            timestamp: new Date().toISOString(),
          },
          ...prev.slice(0, 9),
        ]);
      }
    } catch (err) {
      const contractError = classifyContractError(err);
      setError(contractError.message);
      setErrorType(contractError.type);
      setHistory((prev) => [
        {
          txHash: "",
          functionName,
          status: "FAILED",
          errorType: contractError.type,
          timestamp: new Date().toISOString(),
        },
        ...prev.slice(0, 9),
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Error styling ────────────────────────────────────────

  const getErrorStyle = (type: ContractErrorType | null) => {
    switch (type) {
      case ContractErrorType.NETWORK:
        return "bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400 border-yellow-200";
      case ContractErrorType.CONTRACT:
        return "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200";
      case ContractErrorType.USER_REJECTION:
        return "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-200";
      default:
        return "";
    }
  };

  const getErrorLabel = (type: ContractErrorType | null) => {
    switch (type) {
      case ContractErrorType.NETWORK:
        return "🌐 Network Error";
      case ContractErrorType.CONTRACT:
        return "📜 Contract Error";
      case ContractErrorType.USER_REJECTION:
        return "🚫 User Rejected";
      default:
        return "Error";
    }
  };

  // ── Not connected ────────────────────────────────────────

  if (!wallet.connected) {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 p-10 text-center">
          <div className="h-16 w-16 mx-auto rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12"/>
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-700">Connect Your Wallet</h2>
          <p className="text-sm text-gray-500 mt-1">Connect a Stellar wallet to interact with Soroban contracts.</p>
          <Link href="/" className="text-sm text-ophir-600 hover:underline mt-4 inline-block">← Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Contract Info */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold mb-3">Deployed Contract</h2>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Contract ID</p>
          <p className="text-sm font-mono text-gray-900 dark:text-white break-all">{contractId}</p>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Deploy: <code className="bg-gray-100 px-1 rounded">node scripts/deploy-contract.js &lt;SECRET_KEY&gt;</code>
        </p>
      </div>

      {/* Function Selector */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 p-5 space-y-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Contract Function</label>
        <div className="grid grid-cols-3 gap-2">
          {FUNCTIONS.map((fn) => (
            <button
              key={fn.name}
              onClick={() => setFunctionName(fn.name)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                functionName === fn.name
                  ? "bg-ophir-50 dark:bg-ophir-950/30 text-ophir-700 dark:text-ophir-400 border border-ophir-200"
                  : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 hover:border-gray-300"
              }`}
            >
              {fn.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleSimulate}
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {isLoading ? "Simulating..." : `Simulate ${functionName}()`}
          </button>
          <button
            onClick={handleInvoke}
            disabled={isLoading}
            title={selectedFn.readOnly ? "Read-only functions can be queried via Simulate without signing a transaction" : "Sign and submit a transaction to the Stellar network"}
            className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-ophir-600 to-stellar-dark text-white font-medium text-sm hover:from-ophir-700 hover:to-stellar disabled:opacity-50 transition-all shadow-lg shadow-ophir-500/25"
          >
            {isLoading ? "Submitting..." : `Invoke ${functionName}()`}
          </button>
        </div>
        {selectedFn.readOnly && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            ℹ️ <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{functionName}()</code> is read-only — no transaction signature required.
          </p>
        )}
      </div>

      {/* Error Display — 3 types */}
      {error && (
        <div className={`p-4 rounded-xl border ${getErrorStyle(errorType)}`}>
          <p className="text-sm font-semibold">{getErrorLabel(errorType)}</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Simulation Result */}
      {simResult && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold mb-3">Simulation Result</h2>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Status</span>
              <span className={`text-sm font-semibold ${
                simResult.status === "SIMULATED" ? "text-green-600" : "text-red-600"
              }`}>{simResult.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Return Value</span>
              <span className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                {String(simResult.returnValue ?? "null")}
              </span>
            </div>
            {simResult.error && (
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Error</span>
                <span className="text-sm text-red-600">{simResult.error}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transaction History */}
      {history.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold mb-3">Transaction History</h2>
          <div className="space-y-2">
            {history.map((tx, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100">
                <div>
                  <p className="text-sm font-mono">{tx.functionName}()</p>
                  <p className="text-xs text-gray-400">{new Date(tx.timestamp).toLocaleTimeString()}</p>
                </div>
                <div className="text-right">
                  <p className={`text-xs font-semibold ${tx.status === "SUCCESS" ? "text-green-600" : "text-red-600"}`}>{tx.status}</p>
                  {tx.txHash && (
                    <a href={getStellarExplorerUrl(tx.txHash)} target="_blank" rel="noopener noreferrer" className="text-xs text-ophir-600 hover:underline">
                      {shortenAddress(tx.txHash, 6)}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}