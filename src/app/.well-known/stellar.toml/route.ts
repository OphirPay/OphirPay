// SPDX-License-Identifier: MIT

import { generateStellarToml } from "@/lib/stellar-toml";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/stellar.toml
 *
 * Implements SEP-0001 (Stellar Info File).
 * Wallets and ecosystem explorers query this route to discover organization info,
 * network passphrase, currencies, and deployed smart contract IDs.
 */
export async function GET(): Promise<Response> {
  const content = generateStellarToml();

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
