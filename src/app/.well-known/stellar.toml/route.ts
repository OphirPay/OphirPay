/**
 * GET /.well-known/stellar.toml — SEP-1 discovery document (issue #813).
 *
 * Served from the App Router rather than `public/` so the contract ids and the
 * network passphrase are read from the live configuration instead of being
 * frozen into a static asset at build time.
 */
import { NextResponse } from "next/server";
import { renderStellarToml, resolveStellarTomlConfig } from "@/lib/stellar-toml";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const origin = forwardedHost
    ? `${forwardedProto ?? "https"}://${forwardedHost}`
    : url.origin;

  const body = renderStellarToml(resolveStellarTomlConfig(origin));

  return new NextResponse(body, {
    status: 200,
    headers: {
      // SEP-1 documents are read by wallets, so they must be fetchable
      // cross-origin (the global COOP/CORP headers would otherwise block it).
      "Content-Type": "text/plain; charset=utf-8",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}
