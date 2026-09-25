// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import { validateEnv, getDatabaseProvider } from "@/lib/env";
import { initRateLimitStore } from "@/lib/rate-limit";

/**
 * Application startup bootstrap.
 * Runs once on server start to validate configuration and initialize services.
 */
export async function bootstrap(): Promise<void> {
  const start = Date.now();

  // Validate environment variables with Zod schema (fails fast with clear messages)
  try {
    const env = validateEnv();
    logger.info("OphirPay starting up", {
      version: "0.1.0",
      nodeEnv: env.NODE_ENV,
      database: env.DATABASE_PROVIDER,
      stellarNetwork: env.NEXT_PUBLIC_STELLAR_NETWORK,
      contractId: env.NEXT_PUBLIC_CONTRACT_ID,
      emitterContractId: env.NEXT_PUBLIC_EMITTER_CONTRACT_ID,
      redis: env.REDIS_URL ? "configured" : "not configured",
      email: env.RESEND_API_KEY ? "configured" : "not configured",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Environment validation failed", { error: message });
    // In production, fail fast — do not start with invalid configuration.
    // In development, throw as well since contract IDs are now required.
    throw new Error(
      `Fatal: environment validation failed. Check your .env.local file.\n${message}`
    );
  }

  // Transactional email is configured from the same env validation pass. A
  // missing key is not fatal at boot — local dev and CI intentionally run
  // without one — but every send then fails loudly with
  // EmailConfigurationError rather than silently dropping the message (#800).
  if (!process.env.RESEND_API_KEY) {
    logger.warn(
      "Transactional email is not configured — sendEmail() will throw EmailConfigurationError until RESEND_API_KEY is set (see .env.example)"
    );
  }

  // Initialise rate-limit store (Redis if available, else in-memory)
  await initRateLimitStore();

  // PostgreSQL requires DIRECT_DATABASE_URL for migrations when pooling
  const dbProvider = getDatabaseProvider();
  if (dbProvider === "postgresql" && !process.env.DIRECT_DATABASE_URL) {
    logger.warn(
      "DIRECT_DATABASE_URL not set — connection pooling (e.g. Supabase/Neon) may need this for migrations"
    );
  }

  // Log stellar network configuration
  logger.info("Stellar network configuration", {
    network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "TESTNET",
    rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL || "default",
  });

  const duration = Date.now() - start;
  logger.info("Bootstrap complete", { durationMs: duration });
}
