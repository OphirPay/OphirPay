// SPDX-License-Identifier: MIT

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_PROVIDER: z.enum(["sqlite", "postgresql"]).default("postgresql"),
  DIRECT_DATABASE_URL: z.string().optional(),
  NEXT_PUBLIC_STELLAR_NETWORK: z.enum(["TESTNET", "PUBLIC"]).default("TESTNET"),
  NEXT_PUBLIC_STELLAR_RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org:443"),
  NEXT_PUBLIC_STELLAR_HORIZON_URL: z.string().url().default("https://horizon-testnet.stellar.org"),
  STELLAR_NETWORK_PASSPHRASE: z.string().default("Test SDF Network ; September 2015"),
  NEXT_PUBLIC_CONTRACT_ID: z.string().min(1, "NEXT_PUBLIC_CONTRACT_ID is required — no testnet fallback"),
  NEXT_PUBLIC_EMITTER_CONTRACT_ID: z.string().min(1, "NEXT_PUBLIC_EMITTER_CONTRACT_ID is required — no testnet fallback"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NEXT_PUBLIC_CHAIN_READ_SOURCE: z.string().optional(),
  NEXT_PUBLIC_GA_ID: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  RATE_LIMIT_RPM: z.coerce.number().positive().default(120),
  // Wallet-auth endpoints get stricter per-IP / per-account buckets on top of
  // the global RATE_LIMIT_RPM (see src/lib/auth-rate-limit.ts).
  AUTH_RATE_LIMIT_IP_RPM: z.coerce.number().positive().default(30),
  AUTH_RATE_LIMIT_WALLET_RPM: z.coerce.number().positive().default(10),
  REDIS_URL: z.string().url().optional(),
  AUTH_SECRET: z.string().optional(), // validated via validateAuthSecret (required in production)
  CRON_SECRET: z.string().min(16).optional(), // required for /api/cron (see app/api/cron/route.ts)
  SCHEDULED_PAYMENTS_SOURCE_SECRET: z.string().optional(), // Stellar secret that signs scheduled payments
  NEXT_PUBLIC_DEMO_MODE: z.string().optional(),
  NEXT_PUBLIC_FEATURE_MULTI_ASSET: z.string().optional(),
  NEXT_PUBLIC_FEATURE_WEBHOOKS: z.string().optional(),
  NEXT_PUBLIC_APP_VERSION: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const DISALLOWED_AUTH_SECRET_PATTERNS = [
  "replace-with-openssl-rand-hex-32-output",
  "replace-with-openssl-rand-hex-32",
  "dev-only-auth-secret-000000000000000000000000",
  "openssl rand -hex 32",
  "replace-with-a-secure-secret",
  "replace-me",
  "changeme",
];

export function isPlaceholderAuthSecret(secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  if (DISALLOWED_AUTH_SECRET_PATTERNS.some((p) => normalized === p.toLowerCase())) {
    return true;
  }
  if (
    normalized.includes("replace-with") ||
    normalized.includes("placeholder") ||
    normalized.includes("changeme") ||
    normalized.includes("openssl rand")
  ) {
    return true;
  }
  return false;
}

export function validateAuthSecret(
  secret?: string | null,
  isProd = isProduction()
): { valid: boolean; error?: string } {
  if (!isProd) {
    return { valid: true };
  }

  if (!secret || secret.trim().length === 0) {
    return {
      valid: false,
      error:
        "AUTH_SECRET is required in production. Generate a secure 32+ byte secret with: openssl rand -hex 32",
    };
  }

  const trimmed = secret.trim();

  if (trimmed.length < 32) {
    return {
      valid: false,
      error: `AUTH_SECRET is too short (${trimmed.length} chars). Production requires a minimum of 32 characters. Generate one with: openssl rand -hex 32`,
    };
  }

  if (isPlaceholderAuthSecret(trimmed)) {
    return {
      valid: false,
      error:
        "AUTH_SECRET contains a placeholder or example value ('replace-with-...'). Production deployments must use a cryptographically random secret. Generate one with: openssl rand -hex 32",
    };
  }

  return { valid: true };
}

export function validateEnv(): Env {
  try {
    const parsed = envSchema.parse({
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_PROVIDER: process.env.DATABASE_PROVIDER,
      DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
      NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
      NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
      NEXT_PUBLIC_STELLAR_HORIZON_URL: process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL,
      STELLAR_NETWORK_PASSPHRASE: process.env.STELLAR_NETWORK_PASSPHRASE,
      NEXT_PUBLIC_CONTRACT_ID: process.env.NEXT_PUBLIC_CONTRACT_ID,
      NEXT_PUBLIC_EMITTER_CONTRACT_ID: process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_CHAIN_READ_SOURCE: process.env.NEXT_PUBLIC_CHAIN_READ_SOURCE,
      NEXT_PUBLIC_GA_ID: process.env.NEXT_PUBLIC_GA_ID,
      NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
      RATE_LIMIT_RPM: process.env.RATE_LIMIT_RPM,
      AUTH_RATE_LIMIT_IP_RPM: process.env.AUTH_RATE_LIMIT_IP_RPM,
      AUTH_RATE_LIMIT_WALLET_RPM: process.env.AUTH_RATE_LIMIT_WALLET_RPM,
      REDIS_URL: process.env.REDIS_URL,
      AUTH_SECRET: process.env.AUTH_SECRET,
      CRON_SECRET: process.env.CRON_SECRET,
      SCHEDULED_PAYMENTS_SOURCE_SECRET: process.env.SCHEDULED_PAYMENTS_SOURCE_SECRET,
      NEXT_PUBLIC_FEATURE_MULTI_ASSET: process.env.NEXT_PUBLIC_FEATURE_MULTI_ASSET,
      NEXT_PUBLIC_FEATURE_WEBHOOKS: process.env.NEXT_PUBLIC_FEATURE_WEBHOOKS,
      NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
    });

    const isProd = parsed.NODE_ENV === "production";
    const authSecretCheck = validateAuthSecret(process.env.AUTH_SECRET, isProd);
    if (!authSecretCheck.valid) {
      throw new Error(`Environment validation failed:\n  • AUTH_SECRET: ${authSecretCheck.error}`);
    }

    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((e) => `  • ${e.path.join(".")}: ${e.message}`).join("\n");
      throw new Error(`Environment validation failed:\n${messages}`);
    }
    throw error;
  }
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getDatabaseProvider(): "sqlite" | "postgresql" {
  return (process.env.DATABASE_PROVIDER as "sqlite" | "postgresql") || "postgresql";
}

export function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
