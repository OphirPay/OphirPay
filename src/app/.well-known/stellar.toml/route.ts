// SPDX-License-Identifier: MIT

import { buildStellarToml, readStellarTomlEnv } from "@/lib/stellar-toml";

const CORS_HEADERS = {
  // Wallets and explorers fetch this cross-origin.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
} as const;

/**
 * GET /.well-known/stellar.toml
 *
 * SEP-1 discovery document, generated from environment on every request so
 * contract ids and the network passphrase track deployment config (issue
 * #813). Served as text/plain — SEP-1 clients accept any text type.
 */
export async function GET(): Promise<Response> {
  const body = buildStellarToml(readStellarTomlEnv());
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      ...CORS_HEADERS,
    },
  });
}

/** Preflight for cross-origin wallet fetches. */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
}
