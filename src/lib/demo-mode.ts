// SPDX-License-Identifier: MIT

/**
 * Demo mode utilities.
 * 
 * When NEXT_PUBLIC_DEMO_MODE=true, transactions are simulated instantly
 * without requiring real XLM or Freighter wallet connection.
 * 
 * Perfect for hackathon demos, CI previews, and reviewer walkthroughs.
 */

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/** Check if demo mode is active */
export function isDemoMode(): boolean {
  return DEMO_MODE;
}

/** Generate a deterministic demo TX hash */
export function generateDemoTxHash(prefix = "demo"): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rand}`;
}

/** Simulated payment record returned in demo mode */
export interface DemoPaymentResult {
  id: string;
  txHash: string;
  amount: string;
  payee: string;
  timestamp: number;
  status: "RECORDED";
  demo: true;
}

/** Simulate a payment in demo mode — returns instantly with no wallet needed */
export function simulatePayment(params: {
  payee: string;
  amount: string;
}): DemoPaymentResult {
  return {
    id: `demo_${Date.now()}`,
    txHash: generateDemoTxHash("pay"),
    amount: params.amount,
    payee: params.payee,
    timestamp: Date.now(),
    status: "RECORDED",
    demo: true,
  };
}

/** Simulate a batch payment in demo mode */
export function simulateBatchPayment(params: {
  payees: string[];
  amounts: string[];
}): DemoPaymentResult[] {
  return params.payees.map((payee, i) => ({
    id: `demo_batch_${i}_${Date.now()}`,
    txHash: generateDemoTxHash(`batch_${i}`),
    amount: params.amounts[i] ?? "0",
    payee,
    timestamp: Date.now(),
    status: "RECORDED" as const,
    demo: true,
  }));
}

/** Demo wallet state for when Freighter is not connected */
export const DEMO_WALLET = {
  connected: true,
  // Valid-format Stellar testnet address (demo only — not a real funded account)
  publicKey: "GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO",
  network: "TESTNET",
  balance: "10,000.00",
  balanceLoading: false,
  demo: true,
} as const;

/** Pre-generated demo data for the dashboard */
export const DEMO_PAYMENTS = [
  { id: 1, payee: "GDONOR...1234", amount: "500.00", txHash: generateDemoTxHash("p1"), timestamp: Date.now() - 300000, status: "completed" },
  { id: 2, payee: "GVENDOR...5678", amount: "1,200.00", txHash: generateDemoTxHash("p2"), timestamp: Date.now() - 600000, status: "completed" },
  { id: 3, payee: "GDAO...9012", amount: "50.00", txHash: generateDemoTxHash("p3"), timestamp: Date.now() - 900000, status: "completed" },
];

/** Demo events for the activity feed */
export const DEMO_EVENTS = [
  { event: "payment:created", timestamp: new Date(Date.now() - 60000).toISOString(), paymentId: "3", status: "success", amount: "50.00" },
  { event: "payment:created", timestamp: new Date(Date.now() - 120000).toISOString(), paymentId: "2", status: "success", amount: "1,200.00" },
  { event: "payment:created", timestamp: new Date(Date.now() - 180000).toISOString(), paymentId: "1", status: "success", amount: "500.00" },
];

/** Demo multisig config */
export const DEMO_MULTISIG = {
  threshold: 2,
  signers: ["GABC...DEMO...1111", "GDEF...DEMO...2222", "GHIJ...DEMO...3333"],
  enabled: true,
};

/** Demo governance proposals */
export const DEMO_PROPOSALS = [
  { id: 1, title: "Upgrade to v3", description: "Proposal to upgrade OphirPay contract to version 3 with atomic check-and-spend", action_type: "upgrade", proposer: "GABC...", yes_votes: 12, no_votes: 3, voting_ends_at: Math.floor(Date.now() / 1000) + 3600, executed: false },
  { id: 2, title: "Reduce Fee to 10bps", description: "Lower the platform fee from 50bps to 10bps for payment operations", action_type: "set_fee_config", proposer: "GDEF...", yes_votes: 8, no_votes: 5, voting_ends_at: Math.floor(Date.now() / 1000) + 7200, executed: false },
];
