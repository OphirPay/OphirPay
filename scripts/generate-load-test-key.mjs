#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Utility script to generate/mint a test API key for load testing.
 * Uses Prisma to look up or create a test user and store an API key.
 *
 * Usage:
 *   node scripts/generate-load-test-key.mjs
 */

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rawKey = `oph_${crypto.randomBytes(24).toString("hex")}`;
  const prefix = rawKey.slice(0, 8);
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: "load-test-user",
        name: "Load Test User",
        stellarAddress: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      },
    });
  }

  await prisma.apiKey.create({
    data: {
      name: "load-test-key",
      keyHash,
      prefix,
      userId: user.id,
    },
  });

  // Print raw key to stdout for consumers/subshells
  console.log(rawKey);
}

main()
  .catch((err) => {
    console.error("Failed to generate load-test API key:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
