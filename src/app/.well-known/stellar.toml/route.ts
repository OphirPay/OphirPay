// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import { generateStellarToml } from "@/lib/stellar-toml";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
};

export async function GET() {
  const toml = generateStellarToml();
  return new NextResponse(toml, {
    status: 200,
    headers: CORS_HEADERS,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
