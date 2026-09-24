// SPDX-License-Identifier: MIT

import React, { useEffect, useState } from "react";
import { getRecommendedFee, FeeRecommendation, formatFeeStroops } from "@/lib/fee-estimator";
import { sendTransaction } from "@/lib/stellar";

/**
 * Send page – allows the user to specify a recipient and amount, then signs and
 * submits the transaction. The displayed fee now reflects the live Horizon
 * recommendation.
 */
export default function SendPage() {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [feeRec, setFeeRec] = useState<FeeRecommendation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load fee recommendation on mount and refresh periodically.
  useEffect(() => {
    let cancelled = false;
    const fetchFee = async () => {
      const rec = await getRecommendedFee();
      if (!cancelled) setFeeRec(rec);
    };
    fetchFee();
    const intervalId = setInterval(fetchFee, 30_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (!feeRec) throw new Error("Fee not available");
      await sendTransaction({ recipient, amount: parseFloat(amount), fee: feeRec.fee });
      // Success handling (e.g., navigation) would go here.
    } catch (err: any) {
      setError(err.message ?? "Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="max-w-md mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Send XLM</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-1" htmlFor="recipient">
            Recipient Address
          </label>
          <input
            id="recipient"
            type="text"
            placeholder="G..."
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            required
            className="w-full border rounded p-2"
          />
        </div>
        <div>
          <label className="block mb-1" htmlFor="amount">
            Amount (XLM)
          </label>
          <input
            id="amount"
            type="number"
            step="0.0000001"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="w-full border rounded p-2"
          />
        </div>
        <div className="text-sm text-gray-600">
          {feeRec ? (
            <span>
              Recommended Fee: {formatFeeStroops(feeRec.fee)}
              {feeRec.basis === "fallback" && " (cached)"}
            </span>
          ) : (
            <span>Loading fee recommendation…</span>
          )}
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !feeRec}
          className="w-full bg-blue-600 text-white py-2 rounded disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Confirm & Sign"}
        </button>
      </form>
    </main>
  );
}
