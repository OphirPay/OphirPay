#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Mint an API key for the load-test suite (issue #735).
 *
 * `scripts/load-test.js` exercises `GET /api/payments`, which authenticates with
 * an API key and scopes the result to that key's owner. This script creates (or
 * reuses) a dedicated `load-test@…` user, rotates a single `load-test` key for
 * it, and optionally seeds payments so the list query does realistic work
 * instead of scanning an empty table.
 *
 * Usage:
 *   node scripts/create-load-test-key.mjs                  # print LOAD_TEST_API_KEY=…
 *   node scripts/create-load-test-key.mjs --github-env     # also append to $GITHUB_ENV
 *
 * Environment:
 *   DATABASE_URL             required — the same DB the app under test uses
 *   LOAD_TEST_KEY_NAME       key label (default "load-test")
 *   LOAD_TEST_KEY_EMAIL      owner email (default "load-test@ophirpay.local")
 *   LOAD_TEST_SEED_PAYMENTS  payments to seed for that user (default 0)
 *
 * The key format mirrors `src/lib/api-auth.ts` exactly (`oph_` + 32 CSPRNG bytes,
 * stored as `v1:<sha256>`), and
 * `src/__tests__/load-test-key.test.ts` asserts that equivalence so the two
 * cannot drift apart.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Standard IEEE 802.3 CRC32 lookup table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c;
}

/** Compute standard CRC32 checksum as an unsigned 32-bit integer. */
export function crc32(str) {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    const byte = str.charCodeAt(i) & 0xff;
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Compute standard 8-character lowercase hex CRC checksum. */
export function computeCrcHex(payload) {
  return crc32(payload).toString(16).padStart(8, "0");
}

/** Prefix every OphirPay API key starts with (mirrors src/lib/api-auth.ts). */
export const API_KEY_PREFIX = "op_";
/** Length of the indexed lookup prefix (mirrors API_KEY_PREFIX_LENGTH). */
export const API_KEY_PREFIX_LENGTH = 8;
/** CSPRNG bytes in the random portion (mirrors API_KEY_RANDOM_BYTES). */
export const API_KEY_RANDOM_BYTES = 32;
/** Digest version tag (mirrors API_KEY_DIGEST_VERSION). */
export const API_KEY_DIGEST_VERSION = "v1";

/** op_{env}_{32_hex_bytes}_{4_byte_crc} */
export function generateApiKey(randomBytes = crypto.randomBytes, env = "test") {
  const hex = randomBytes(API_KEY_RANDOM_BYTES).toString("hex");
  const payload = `op_${env}_${hex}`;
  const crc = computeCrcHex(payload);
  return `${payload}_${crc}`;
}

/** `v1:<sha256 hex>` — the digest stored in `ApiKey.keyHash`. */
export function hashApiKeyV1(rawKey) {
  const digest = crypto.createHash("sha256").update(rawKey).digest("hex");
  return `${API_KEY_DIGEST_VERSION}:${digest}`;
}

/** First 8 characters of the raw key, for indexed lookup + display. */
export function deriveKeyPrefix(rawKey) {
  return rawKey.slice(0, API_KEY_PREFIX_LENGTH);
}

/**
 * Create the load-test user + key (and optionally seed payments).
 * Returns `{ rawKey, userId, seeded }`. Safe to run repeatedly: the user is
 * reused and previous `load-test` keys are removed before minting a new one.
 */
export async function provisionLoadTestKey({
  prisma,
  keyName = "load-test",
  email = "load-test@ophirpay.local",
  seedPayments = 0,
} = {}) {
  if (!prisma) throw new Error("provisionLoadTestKey requires a PrismaClient");

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Load Test" },
  });

  // Rotate: any previous key with this label is revoked so a re-run cannot
  // leave an unbounded pile of valid credentials behind.
  await prisma.apiKey.deleteMany({ where: { userId: user.id, name: keyName } });

  const rawKey = generateApiKey();
  await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: keyName,
      keyHash: hashApiKeyV1(rawKey),
      prefix: deriveKeyPrefix(rawKey),
      scopes: ["read:payments"],
    },
  });

  let seeded = 0;
  if (seedPayments > 0) {
    const existing = await prisma.payment.count({ where: { userId: user.id } });
    const missing = Math.max(0, seedPayments - existing);
    if (missing > 0) {
      await prisma.payment.createMany({
        data: Array.from({ length: missing }, (_, i) => ({
          userId: user.id,
          // Deterministic, realistic-looking amounts so key-set pagination is
          // exercised rather than a single-row table.
          amount: ((i % 500) + 1) / 2,
          assetCode: "XLM",
          description: `load-test payment ${i}`,
        })),
      });
    }
    seeded = await prisma.payment.count({ where: { userId: user.id } });
  }

  return { rawKey, userId: user.id, seeded };
}

// ── CLI ────────────────────────────────────────────────────────

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const { rawKey, seeded } = await provisionLoadTestKey({
      prisma,
      keyName: process.env.LOAD_TEST_KEY_NAME || "load-test",
      email: process.env.LOAD_TEST_KEY_EMAIL || "load-test@ophirpay.local",
      seedPayments: Number(process.env.LOAD_TEST_SEED_PAYMENTS || 0) || 0,
    });

    if (seedPaymentsRequested(process.env.LOAD_TEST_SEED_PAYMENTS)) {
      console.error(`Seeded ${seeded} payment(s) for the load-test user.`);
    }

    if (process.argv.includes("--github-env")) {
      // Never let the key leak into an unbounded log; GitHub masks it.
      console.log(`::add-mask::${rawKey}`);
      const envFile = process.env.GITHUB_ENV;
      if (envFile) {
        fs.appendFileSync(envFile, `LOAD_TEST_API_KEY=${rawKey}\n`);
        console.error("Wrote LOAD_TEST_API_KEY to $GITHUB_ENV");
      } else {
        console.error("GITHUB_ENV is not set — printing the key instead.");
        console.log(`LOAD_TEST_API_KEY=${rawKey}`);
      }
    } else {
      console.log(`LOAD_TEST_API_KEY=${rawKey}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function seedPaymentsRequested(value) {
  return Number(value || 0) > 0;
}

// Only run when invoked directly, never on import (the tests import it).
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((err) => {
    console.error(`Failed to create a load-test API key: ${err.message}`);
    process.exit(1);
  });
}
