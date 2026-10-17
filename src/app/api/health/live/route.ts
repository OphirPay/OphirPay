// SPDX-License-Identifier: MIT
import { successResponse } from "@/lib/api-response";
import pkg from "../../../../../package.json";

/**
 * Liveness probe — `GET /api/health/live` (issue #738).
 *
 * Answers exactly one question: **is this process alive and serving HTTP?**
 * It performs no I/O — no database ping, no Soroban RPC call, no Horizon or
 * Redis round trip — so a transient dependency outage can never restart-loop
 * an otherwise healthy container.
 *
 * Readiness is a different question with a different answer, and it keeps its
 * existing home in `GET /api/health`: that route pings the database (critical),
 * the Stellar RPC/Horizon endpoints, Redis when configured, and validates the
 * configured contract ID. Orchestrators should therefore wire:
 *
 *   • `livenessProbe`  → `/api/health/live`  (never depends on a dependency)
 *   • `readinessProbe` → `/api/health`       (503 while a dependency is down,
 *                                             so traffic drains without a restart)
 *
 * The Docker `HEALTHCHECK` uses this route for the same reason (see
 * `Dockerfile` and `docs/DEPLOYMENT.md` → "Liveness vs readiness").
 *
 * The response body is constant apart from `uptime`, so it is safe to poll at
 * high frequency and cheap to cache in a log line.
 */
export function GET() {
  const version =
    process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
    process.env.npm_package_version?.trim() ||
    pkg.version;
  const commit =
    process.env.GIT_SHA?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.NEXT_PUBLIC_GIT_SHA?.trim() ||
    "unknown";

  return successResponse({
    status: "ok",
    probe: "liveness",
    version,
    commit,
    uptime: process.uptime(),
  });
}
