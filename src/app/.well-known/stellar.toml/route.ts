// SPDX-License-Identifier: MIT
//
// GET /.well-known/stellar.toml — SEP-1 discovery document (issue #813).
//
// Served as a route handler rather than a static file in `public/` so the
// document is rendered from the same configuration the rest of the app reads.
// A static copy would happily advertise the wrong network passphrase after a
// network switch, because nothing links the file to the config.

import { NextResponse } from "next/server";
import { buildStellarToml } from "@/lib/stellar-toml";

// Fully static payload: no request-time inputs, so let Next pre-render it.
export const dynamic = "force-static";
export const revalidate = false;

export function GET(): NextResponse {
  return new NextResponse(buildStellarToml(), {
    status: 200,
    headers: {
      // SEP-1 requires the TOML media type. `text/plain` would be sniffed
      // inconsistently by non-browser clients.
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      // Discovery document: safe for any origin to read.
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
