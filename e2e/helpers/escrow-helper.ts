// SPDX-License-Identifier: MIT
import type { Page } from "@playwright/test";

export type EscrowDisputeStatus = "ACTIVE" | "DISPUTED" | "RESOLVED";

export type EscrowResolutionOutcome = "FAVOR_BUYER" | "FAVOR_SELLER" | null;

export interface EscrowDisputeRecord {
  id: number;
  depositor: string;
  beneficiary: string;
  arbiter: string;
  /** Escrow amount in stroops (1 XLM = 10,000,000 stroops) */
  amount: string;
  asset: string;
  created_at: number;
  deadline: number;
  released: boolean;
  claimed: boolean;
  metadata: string;
  status: EscrowDisputeStatus;
  disputeReason: string | null;
  disputedBy: string | null;
  disputedAt: number | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  resolutionOutcome: EscrowResolutionOutcome;
  txHash: string | null;
}

export interface PartyEscrowUiView {
  escrowId: number;
  viewer: string;
  role: "buyer" | "seller" | "arbitrator" | "observer";
  status: EscrowDisputeStatus;
  badgeLabel: "Locked" | "Disputed" | "Settled";
  disputeBannerVisible: boolean;
  disputeBannerText: string | null;
  canInitiateDispute: boolean;
  canStandardReleaseOrClaim: boolean;
  canArbitrateReleaseToBuyer: boolean;
  canArbitrateReleaseToSeller: boolean;
}

export interface EscrowDisputeState {
  escrows: EscrowDisputeRecord[];
  /** Wallet balances keyed by Stellar G-address, stored as stroops */
  balances: Record<string, bigint>;
  /** Contract escrow vault balance in stroops */
  vaultBalance: bigint;
  contractOwner: string;
  activeActor: string;
  ledgerSequence: number;
}

export const BUYER_ADDRESS =
  "GBUYER7ESCROW2DISPUTE4TEST7ACCOUNT3A6B9C2D4E6F8G2H4J6K8L";
export const SELLER_ADDRESS =
  "GSELLER8ESCROW2DISPUTE4TEST7ACCOUNT3A6B9C2D4E6F8G2H4J6K9";
export const ARBITRATOR_ADDRESS =
  "GARBITRATOR9ESCROW2DISPUTE4TEST7ACCT3A6B9C2D4E6F8G2H4J7M";
export const CONTRACT_OWNER_ADDRESS =
  "GOWNER5ESCROW2DISPUTE4TEST7ACCOUNT3A6B9C2D4E6F8G2H4J6K2P";

const STROOPS_PER_XLM = 10_000_000n;

export function xlmToStroops(xlm: number | string): bigint {
  const [wholePart, fracPart = ""] = String(xlm).split(".");
  const normalizedFrac = (fracPart + "0000000").slice(0, 7);
  return BigInt(wholePart) * STROOPS_PER_XLM + BigInt(normalizedFrac);
}

export function stroopsToXlmString(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = (stroops % STROOPS_PER_XLM).toString().padStart(7, "0");
  return `${whole.toString()}.${frac}`;
}

export function createEscrowDisputeState(options?: {
  initialEscrows?: EscrowDisputeRecord[];
  buyerBalanceStroops?: bigint;
  sellerBalanceStroops?: bigint;
  arbitratorBalanceStroops?: bigint;
  activeActor?: string;
}): EscrowDisputeState {
  const initialEscrows = options?.initialEscrows ?? [
    createSeededEscrowRecord({
      id: 1,
      amountStroops: xlmToStroops(250),
      metadata: "Order #1405 - Enterprise hardware delivery escrow",
    }),
  ];

  const vaultBalance = initialEscrows.reduce((sum, item) => {
    if (item.released || item.claimed || item.status === "RESOLVED") {
      return sum;
    }
    return sum + BigInt(item.amount);
  }, 0n);

  return {
    escrows: initialEscrows.map((escrow) => ({ ...escrow })),
    balances: {
      [BUYER_ADDRESS]: options?.buyerBalanceStroops ?? xlmToStroops(750),
      [SELLER_ADDRESS]: options?.sellerBalanceStroops ?? xlmToStroops(100),
      [ARBITRATOR_ADDRESS]: options?.arbitratorBalanceStroops ?? xlmToStroops(50),
      [CONTRACT_OWNER_ADDRESS]: xlmToStroops(500),
    },
    vaultBalance,
    contractOwner: CONTRACT_OWNER_ADDRESS,
    activeActor: options?.activeActor ?? BUYER_ADDRESS,
    ledgerSequence: 512_000,
  };
}

export function createSeededEscrowRecord(params?: {
  id?: number;
  depositor?: string;
  beneficiary?: string;
  arbiter?: string;
  amountStroops?: bigint;
  createdAt?: number;
  deadline?: number;
  metadata?: string;
}): EscrowDisputeRecord {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const amount = (params?.amountStroops ?? xlmToStroops(250)).toString();
  return {
    id: params?.id ?? 1,
    depositor: params?.depositor ?? BUYER_ADDRESS,
    beneficiary: params?.beneficiary ?? SELLER_ADDRESS,
    arbiter: params?.arbiter ?? ARBITRATOR_ADDRESS,
    amount,
    asset: "native",
    created_at: params?.createdAt ?? nowSeconds - 3600,
    deadline: params?.deadline ?? nowSeconds + 86_400,
    released: false,
    claimed: false,
    metadata: params?.metadata ?? "Order #1405 - Escrow payment",
    status: "ACTIVE",
    disputeReason: null,
    disputedBy: null,
    disputedAt: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionOutcome: null,
    txHash: null,
  };
}

export function getWalletBalanceStroops(
  state: EscrowDisputeState,
  address: string,
): bigint {
  return state.balances[address] ?? 0n;
}

/**
 * Transitions an active escrow to DISPUTED when initiated by the buyer (depositor)
 * or seller (beneficiary). Standard release/claim actions become locked until
 * the designated arbitrator resolves the dispute.
 */
export function initiateEscrowDispute(
  state: EscrowDisputeState,
  escrowId: number,
  caller: string,
  reason: string,
): EscrowDisputeRecord {
  const escrow = state.escrows.find((item) => item.id === escrowId);
  if (!escrow) {
    throw new Error(`Escrow #${escrowId} not found.`);
  }
  if (escrow.status !== "ACTIVE" || escrow.released || escrow.claimed) {
    throw new Error(
      `Escrow #${escrowId} cannot be disputed from status ${escrow.status}.`,
    );
  }
  if (caller !== escrow.depositor && caller !== escrow.beneficiary) {
    throw new Error(
      "Only the buyer (depositor) or seller (beneficiary) may initiate an escrow dispute.",
    );
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new Error("A dispute reason is required.");
  }

  state.ledgerSequence += 1;
  escrow.status = "DISPUTED";
  escrow.disputeReason = trimmedReason;
  escrow.disputedBy = caller;
  escrow.disputedAt = Math.floor(Date.now() / 1000);
  escrow.metadata = `[DISPUTED] ${trimmedReason}`;
  escrow.txHash = `${escrowId.toString(16).padStart(8, "0")}d15p07e0${state.ledgerSequence
    .toString(16)
    .padStart(8, "0")}`.padEnd(64, "a");

  return { ...escrow };
}

/**
 * Resolves a disputed (or active) escrow via the designated arbitrator account.
 * Mirrors Soroban `release_by_arbiter(arbiter, escrow_id, release_to_beneficiary)`:
 * - When `releaseToBeneficiary === false` (resolved in favor of the buyer),
 *   escrowed funds are returned to `escrow.depositor`.
 * - When `releaseToBeneficiary === true` (resolved in favor of the seller),
 *   escrowed funds are released to `escrow.beneficiary`.
 */
export function resolveEscrowDispute(
  state: EscrowDisputeState,
  escrowId: number,
  arbitrator: string,
  releaseToBeneficiary: boolean,
): {
  escrow: EscrowDisputeRecord;
  recipient: string;
  amountStroops: bigint;
  buyerBalanceStroops: bigint;
  sellerBalanceStroops: bigint;
} {
  const escrow = state.escrows.find((item) => item.id === escrowId);
  if (!escrow) {
    throw new Error(`Escrow #${escrowId} not found.`);
  }
  if (escrow.status === "RESOLVED" || escrow.released || escrow.claimed) {
    throw new Error(`Escrow #${escrowId} has already been settled.`);
  }
  if (escrow.status !== "DISPUTED") {
    throw new Error(
      `Escrow #${escrowId} must be in DISPUTED status before dispute resolution.`,
    );
  }
  if (!escrow.arbiter || arbitrator !== escrow.arbiter) {
    throw new Error(
      "Unauthorized: only the designated arbitrator can resolve this dispute.",
    );
  }

  const amountStroops = BigInt(escrow.amount);
  if (state.vaultBalance < amountStroops) {
    throw new Error("Insufficient escrow vault balance for settlement.");
  }

  const recipient = releaseToBeneficiary ? escrow.beneficiary : escrow.depositor;
  state.vaultBalance -= amountStroops;
  state.balances[recipient] = (state.balances[recipient] ?? 0n) + amountStroops;
  state.ledgerSequence += 1;

  escrow.status = "RESOLVED";
  escrow.released = true;
  escrow.resolvedBy = arbitrator;
  escrow.resolvedAt = Math.floor(Date.now() / 1000);
  escrow.resolutionOutcome = releaseToBeneficiary ? "FAVOR_SELLER" : "FAVOR_BUYER";
  escrow.metadata = releaseToBeneficiary
    ? `[RESOLVED: FAVOR_SELLER] Released to beneficiary by arbiter`
    : `[RESOLVED: FAVOR_BUYER] Refunded to buyer by arbiter`;
  escrow.txHash = `${escrowId.toString(16).padStart(8, "0")}ae5017ed${state.ledgerSequence
    .toString(16)
    .padStart(8, "0")}`.padEnd(64, "b");

  return {
    escrow: { ...escrow },
    recipient,
    amountStroops,
    buyerBalanceStroops: getWalletBalanceStroops(state, escrow.depositor),
    sellerBalanceStroops: getWalletBalanceStroops(state, escrow.beneficiary),
  };
}

/**
 * Computes the deterministic UI state visible to a specific party (buyer,
 * seller, or arbitrator) for assertions across multi-party E2E flows.
 */
export function getEscrowViewForParty(
  state: EscrowDisputeState,
  escrowId: number,
  viewerAddress: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): PartyEscrowUiView {
  const escrow = state.escrows.find((item) => item.id === escrowId);
  if (!escrow) {
    throw new Error(`Escrow #${escrowId} not found.`);
  }

  const role: PartyEscrowUiView["role"] =
    viewerAddress === escrow.depositor
      ? "buyer"
      : viewerAddress === escrow.beneficiary
        ? "seller"
        : viewerAddress === escrow.arbiter
          ? "arbitrator"
          : "observer";

  const isDisputed = escrow.status === "DISPUTED";
  const isResolved = escrow.status === "RESOLVED" || escrow.released || escrow.claimed;
  const deadlineReached = nowSeconds >= escrow.deadline;

  const badgeLabel: PartyEscrowUiView["badgeLabel"] = isResolved
    ? "Settled"
    : isDisputed
      ? "Disputed"
      : "Locked";

  const disputeBannerVisible = isDisputed;
  const disputeBannerText = isDisputed
    ? `Dispute active: ${escrow.disputeReason ?? "Under arbitration"} — standard release actions are locked pending arbitrator resolution.`
    : null;

  return {
    escrowId: escrow.id,
    viewer: viewerAddress,
    role,
    status: escrow.status,
    badgeLabel,
    disputeBannerVisible,
    disputeBannerText,
    canInitiateDispute:
      escrow.status === "ACTIVE" && (role === "buyer" || role === "seller"),
    // Standard claim/release actions are strictly disabled while DISPUTED or RESOLVED
    canStandardReleaseOrClaim:
      escrow.status === "ACTIVE" &&
      !isDisputed &&
      !isResolved &&
      ((role === "seller" && deadlineReached) ||
        viewerAddress === state.contractOwner),
    canArbitrateReleaseToBuyer:
      role === "arbitrator" && !isResolved && isDisputed,
    canArbitrateReleaseToSeller:
      role === "arbitrator" && !isResolved && isDisputed,
  };
}

/**
 * Installs Playwright route mocks for the Escrow Dispute & Resolution E2E flow:
 * - `/api/auth/me` and `/api/csrf`
 * - `/api/escrows` and `/api/escrows/:id`
 * - `/api/escrows/:id/dispute` (buyer/seller dispute initiation)
 * - `/api/escrows/:id/resolve` (arbitrator resolution)
 * - Horizon account balance lookups (`/accounts/:address`)
 * - Soroban JSON-RPC (`simulateTransaction`, `sendTransaction`, `getTransaction`)
 */
export async function installEscrowDisputeMocks(
  page: Page,
  state: EscrowDisputeState,
): Promise<void> {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: {
          id: "usr_e2e_escrow_1405",
          address: state.activeActor,
          role: state.activeActor === ARBITRATOR_ADDRESS ? "admin" : "merchant",
        },
      }),
    });
  });

  await page.route("**/api/csrf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "csrf-e2e-escrow-1405" }),
    });
  });

  // Dispute initiation endpoint
  await page.route("**/api/escrows/*/dispute", async (route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/").filter(Boolean);
    const id = Number(segments[segments.indexOf("escrows") + 1]);
    try {
      const payload = (route.request().postDataJSON?.() ?? {}) as {
        caller?: string;
        reason?: string;
      };
      const updated = initiateEscrowDispute(
        state,
        id,
        payload.caller ?? state.activeActor,
        payload.reason ?? "Goods not delivered as specified",
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: updated }),
      });
    } catch (err) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            message: err instanceof Error ? err.message : "Dispute failed",
          },
        }),
      });
    }
  });

  // Arbitrator resolution endpoint
  await page.route("**/api/escrows/*/resolve", async (route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/").filter(Boolean);
    const id = Number(segments[segments.indexOf("escrows") + 1]);
    try {
      const payload = (route.request().postDataJSON?.() ?? {}) as {
        arbitrator?: string;
        releaseToBeneficiary?: boolean;
      };
      const resolution = resolveEscrowDispute(
        state,
        id,
        payload.arbitrator ?? state.activeActor,
        Boolean(payload.releaseToBeneficiary),
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            escrow: resolution.escrow,
            recipient: resolution.recipient,
            amountStroops: resolution.amountStroops.toString(),
            buyerBalanceStroops: resolution.buyerBalanceStroops.toString(),
            sellerBalanceStroops: resolution.sellerBalanceStroops.toString(),
          },
        }),
      });
    } catch (err) {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            message: err instanceof Error ? err.message : "Resolution failed",
          },
        }),
      });
    }
  });

  // Individual escrow record read: GET /api/escrows/:id
  await page.route(/\/api\/escrows\/\d+$/, async (route) => {
    const url = new URL(route.request().url());
    const id = Number(url.pathname.split("/").pop());
    const record = state.escrows.find((item) => item.id === id);
    if (!record) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Escrow not found" } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: record }),
    });
  });

  // Escrow count endpoint: GET /api/escrows
  await page.route(/\/api\/escrows(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          count: state.escrows.length,
          available: true,
        },
      }),
    });
  });

  // Horizon account balances
  await page.route("**/accounts/*", async (route) => {
    const url = new URL(route.request().url());
    const accountId = url.pathname.split("/").pop() ?? state.activeActor;
    const balanceStroops = getWalletBalanceStroops(state, accountId);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: accountId,
        account_id: accountId,
        sequence: "1029384756",
        subentry_count: 0,
        balances: [
          {
            balance: stroopsToXlmString(balanceStroops),
            asset_type: "native",
          },
        ],
      }),
    });
  });
}
