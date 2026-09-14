// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-session";
import { successResponse, unauthorizedError, badRequestError, handleApiError } from "@/lib/api-response";
import { aggregateApiKeyUsage } from "@/lib/api-key-usage";

const WINDOWS = { "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000, "30d": 30 * 24 * 60 * 60 * 1000 } as const;
type UsageWindow = keyof typeof WINDOWS;

/** GET /api/keys/stats?window=30d - request totals per owned API key. */
export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const requestedWindow = new URL(request.url).searchParams.get("window") ?? "30d";
    if (!(requestedWindow in WINDOWS)) return badRequestError("Window must be 24h, 7d, or 30d");
    const window = requestedWindow as UsageWindow;
    const now = new Date();
    const since = new Date(now.getTime() - WINDOWS[window]);

    const keys = await prisma.apiKey.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, prefix: true, lastUsed: true, createdAt: true, expiresAt: true },
    });
    const requests = await prisma.apiKeyRequestLog.findMany({
      where: { key: { userId: auth.userId } },
      select: { keyId: true, createdAt: true },
    });

    return successResponse({ window, since, keys: aggregateApiKeyUsage(keys, requests, since) });
  } catch (err) {
    return handleApiError(err, "GET /api/keys/stats");
  }
}