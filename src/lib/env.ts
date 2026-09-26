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
  // Strength is enforced by `assertAuthSecret` (production only) so a single
  // validator owns the "generate one with openssl rand -hex 32" message.
  AUTH_SECRET: z.string().optional(),
  CRON_SECRET: z.string().min(16).optional(), // required for /api/cron (see app/api/cron/route.ts)
  METRICS_TOKEN: z.string().min(16).optional(), // required to scrape /api/metrics (see app/api/metrics/route.ts)
  WEBHOOK_ALLOWED_PORTS: z.string().optional(), // comma-separated webhook target ports (default 80,443)
  SCHEDULED_PAYMENTS_SOURCE_SECRET: z.string().optional(), // Stellar secret that signs scheduled payments
  NEXT_PUBLIC_DEMO_MODE: z.string().optional(),
  NEXT_PUBLIC_FEATURE_MULTI_ASSET: z.string().optional(),
  NEXT_PUBLIC_FEATURE_WEBHOOKS: z.string().optional(),
  NEXT_PUBLIC_APP_VERSION: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// ── AUTH_SECRET strength (issue #705) ──────────────────────────
//
// AUTH_SECRET signs wallet session cookies. A deployment that ships the
// `.env.example` placeholder boots normally and signs sessions with a
// publicly known string, so anyone can forge a session. Presence alone is
// not enough — the value must also be high-entropy. This check lives here
// (not only in auth-session) so `bootstrap()` fails fast at startup.

/** Minimum AUTH_SECRET length in bytes (matches `openssl rand -hex 32`). */
export const AUTH_SECRET_MIN_BYTES = 32;

/** The literal value shipped in `.env.example` (and its template variants). */
export const AUTH_SECRET_PLACEHOLDER = "replace-with-openssl-rand-hex-32-output";

/**
 * Substrings that never appear in a CSPRNG-generated secret. Matching is
 * case-insensitive; a genuine `openssl rand -hex 32` value is pure hex and so
 * cannot collide with any of them.
 */
const AUTH_SECRET_PLACEHOLDER_MARKERS = [
  "replace-with",
  "replace_with",
  "replace-me",
  "replace_me",
  "changeme",
  "change-me",
  "change_me",
  "placeholder",
  "your-secret",
  "your_secret",
  "example-secret",
  "example_secret",
  "insecure",
  "not-a-real",
  "dummy-secret",
] as const;

/**
 * Validate an AUTH_SECRET value.
 *
 * Returns `null` when the value is acceptable, otherwise a human-readable
 * reason. Byte length is checked (not JavaScript string length) so a
 * multi-byte passphrase is measured the way the signer uses it.
 */
export function authSecretProblem(
  secret: string | undefined | null
): string | null {
  const value = typeof secret === "string" ? secret.trim() : "";
  if (!value) return "AUTH_SECRET is not set";
  if (value === AUTH_SECRET_PLACEHOLDER) {
    return "AUTH_SECRET is still the placeholder shipped in .env.example";
  }
  const lower = value.toLowerCase();
  const marker = AUTH_SECRET_PLACEHOLDER_MARKERS.find((m) => lower.includes(m));
  if (marker) {
    return `AUTH_SECRET looks like a placeholder (contains "${marker}")`;
  }
  if (new TextEncoder().encode(value).length < AUTH_SECRET_MIN_BYTES) {
    return `AUTH_SECRET must be at least ${AUTH_SECRET_MIN_BYTES} bytes`;
  }
  if (/^(.)\1+$/.test(value)) {
    return "AUTH_SECRET is a single repeated character";
  }
  return null;
}

/**
 * Throwing variant used at startup and on the signing path. The message names
 * the variable and the exact command that produces a valid value.
 */
export function assertAuthSecret(secret: string | undefined | null): string {
  const problem = authSecretProblem(secret);
  if (problem) {
    throw new Error(
      `AUTH_SECRET is required in production: ${problem}. ` +
        "Generate one with: openssl rand -hex 32"
    );
  }
  return (secret as string).trim();
}

export function validateEnv(): Env {
  try {
    const env = envSchema.parse({
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
      NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
      CRON_SECRET: process.env.CRON_SECRET,
      METRICS_TOKEN: process.env.METRICS_TOKEN,
      WEBHOOK_ALLOWED_PORTS: process.env.WEBHOOK_ALLOWED_PORTS,
      SCHEDULED_PAYMENTS_SOURCE_SECRET: process.env.SCHEDULED_PAYMENTS_SOURCE_SECRET,
      NEXT_PUBLIC_FEATURE_MULTI_ASSET: process.env.NEXT_PUBLIC_FEATURE_MULTI_ASSET,
      NEXT_PUBLIC_FEATURE_WEBHOOKS: process.env.NEXT_PUBLIC_FEATURE_WEBHOOKS,
      NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
    });

    // Production must never sign sessions with a placeholder or short value.
    // The Zod schema only enforces `min(32)` when the variable is present and
    // optional, so the placeholder passes it — refuse it explicitly here.
    if (env.NODE_ENV === "production") {
      assertAuthSecret(env.AUTH_SECRET);
    }

    return env;
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
