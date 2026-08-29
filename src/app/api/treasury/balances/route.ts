// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  validationError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { treasuryBalancesQuerySchema } from "@/lib/validation-schemas";
import { isValidStellarAddress } from "@/lib/stellar";
import {
  getTreasuryBalances,
  type WalletQueryInput,
  TREASURY_CACHE_TTL_MS,
} from "@/lib/treasury-balances";

/**
 * GET /api/treasury/balances — Aggregate multi-asset balances across wallets for the Treasury Dashboard.
 *
 * Query Parameters:
 * - wallets: Comma-separated Stellar public keys (optional if authenticated)
 * - assets: Comma-separated asset identifiers (e.g., "XLM", "USDC:GBBD47...", "EURC")
 * - refresh: Boolean / "true" / "1" to bypass cache and force real-time on-chain fetch
 * - includeAllDiscovered: Boolean (default true) to include all assets discovered on account trustlines
 */
export const GET = withMetrics(
  "GET /api/treasury/balances",
  withRequestLogging(async function GET(request: Request) {
    try {
      const url = new URL(request.url);
      const auth = await getAuthContext(request);

      const parsedQuery = treasuryBalancesQuerySchema.safeParse({
        wallets: url.searchParams.get("wallets") ?? undefined,
        assets: url.searchParams.get("assets") ?? undefined,
        refresh:
          url.searchParams.get("refresh") ??
          url.searchParams.get("force") ??
          undefined,
        includeAllDiscovered:
          url.searchParams.get("includeAllDiscovered") ?? undefined,
      });

      if (!parsedQuery.success) {
        return validationError(parsedQuery.error);
      }

      const {
        wallets: rawWallets,
        assets: rawAssets,
        refresh,
        includeAllDiscovered,
      } = parsedQuery.data;

      const walletList: WalletQueryInput[] = [];

      if (rawWallets) {
        const pks = rawWallets
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean);

        for (const pk of pks) {
          if (!isValidStellarAddress(pk)) {
            return badRequestError(`Invalid Stellar public key in wallets parameter: ${pk}`);
          }
          walletList.push({ publicKey: pk, name: `Wallet ${pk.slice(0, 4)}...${pk.slice(-4)}` });
        }
      } else if (auth) {
        // Authenticated user: fetch linked active accounts
        const userAccounts = await prisma.account.findMany({
          where: { userId: auth.userId, isActive: true },
          select: { id: true, publicKey: true, name: true },
        });

        for (const acc of userAccounts) {
          walletList.push({
            id: acc.id,
            publicKey: acc.publicKey,
            name: acc.name,
          });
        }

        // If no accounts in database, check session public key or user record
        if (walletList.length === 0) {
          const user = await prisma.user.findUnique({
            where: { id: auth.userId },
            select: { stellarAddress: true, name: true },
          });

          const pk = auth.publicKey || user?.stellarAddress;
          if (pk && isValidStellarAddress(pk)) {
            walletList.push({
              publicKey: pk,
              name: user?.name || `Primary Wallet (${pk.slice(0, 4)}...${pk.slice(-4)})`,
            });
          }
        }
      } else {
        return unauthorizedError(
          "Authentication required. Connect your wallet, provide an API key, or provide ?wallets=<public_keys>"
        );
      }

      if (walletList.length === 0) {
        return badRequestError(
          "No valid wallets found to aggregate. Link an account or specify ?wallets=G..."
        );
      }

      // Parse target assets filter
      const targetAssets = rawAssets
        ? rawAssets
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean)
        : undefined;

      const result = await getTreasuryBalances(walletList, {
        refresh,
        includeAllDiscovered,
        targetAssets,
        ttlMs: TREASURY_CACHE_TTL_MS,
      });

      const cacheHeader = refresh
        ? "no-cache, no-store, must-revalidate"
        : "public, max-age=30, stale-while-revalidate=60";

      return successResponse(result, undefined, 200, cacheHeader);
    } catch (err) {
      return handleApiError(err, "GET /api/treasury/balances");
    }
  })
);

/**
 * POST /api/treasury/balances — Aggregate multi-asset balances via JSON body.
 */
export const POST = withMetrics(
  "POST /api/treasury/balances",
  withRequestLogging(async function POST(request: Request) {
    try {
      const auth = await getAuthContext(request);
      const body = (await request.json().catch(() => ({}))) as {
        wallets?: (string | WalletQueryInput)[];
        assets?: string[];
        refresh?: boolean;
        includeAllDiscovered?: boolean;
      };

      const walletList: WalletQueryInput[] = [];

      if (Array.isArray(body.wallets) && body.wallets.length > 0) {
        for (const item of body.wallets) {
          const pk = typeof item === "string" ? item.trim() : item.publicKey?.trim();
          if (!pk || !isValidStellarAddress(pk)) {
            return badRequestError(`Invalid Stellar public key in wallets payload: ${pk}`);
          }
          walletList.push({
            publicKey: pk,
            name: typeof item === "object" && item.name ? item.name : `Wallet ${pk.slice(0, 4)}...${pk.slice(-4)}`,
            id: typeof item === "object" ? item.id : undefined,
          });
        }
      } else if (auth) {
        const userAccounts = await prisma.account.findMany({
          where: { userId: auth.userId, isActive: true },
          select: { id: true, publicKey: true, name: true },
        });

        for (const acc of userAccounts) {
          walletList.push({
            id: acc.id,
            publicKey: acc.publicKey,
            name: acc.name,
          });
        }

        if (walletList.length === 0) {
          const user = await prisma.user.findUnique({
            where: { id: auth.userId },
            select: { stellarAddress: true, name: true },
          });

          const pk = auth.publicKey || user?.stellarAddress;
          if (pk && isValidStellarAddress(pk)) {
            walletList.push({
              publicKey: pk,
              name: user?.name || `Primary Wallet (${pk.slice(0, 4)}...${pk.slice(-4)})`,
            });
          }
        }
      } else {
        return unauthorizedError(
          "Authentication required. Connect your wallet, provide an API key, or provide wallets array in request body."
        );
      }

      if (walletList.length === 0) {
        return badRequestError("No valid wallets provided for aggregation.");
      }

      const result = await getTreasuryBalances(walletList, {
        refresh: Boolean(body.refresh),
        includeAllDiscovered: body.includeAllDiscovered !== false,
        targetAssets: body.assets,
        ttlMs: TREASURY_CACHE_TTL_MS,
      });

      const cacheHeader = body.refresh
        ? "no-cache, no-store, must-revalidate"
        : "public, max-age=30, stale-while-revalidate=60";

      return successResponse(result, undefined, 200, cacheHeader);
    } catch (err) {
      return handleApiError(err, "POST /api/treasury/balances");
    }
  })
);
