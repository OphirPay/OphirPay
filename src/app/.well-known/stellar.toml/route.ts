// SPDX-License-Identifier: MIT

/**
 * Route handler for GET /.well-known/stellar.toml
 *
 * Implements SEP-1 (Stellar Ecosystem Proposal 0001) discovery endpoint.
 * Dynamically generated from environment variables so contract IDs,
 * network passphrases, and issuer accounts stay synchronized.
 */

import { buildStellarToml } from "@/lib/stellar-toml";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET() {
  const tomlContent = buildStellarToml(process.env);

  return new Response(tomlContent, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      ...CORS_HEADERS,
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
