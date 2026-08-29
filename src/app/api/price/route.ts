// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";

let cachedPrice: { price: number; updatedAt: string; source: string } | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60_000;

export async function GET() {
  const now = Date.now();
  if (cachedPrice && now - lastFetchTime < CACHE_TTL_MS) {
    return NextResponse.json({
      success: true,
      ...cachedPrice,
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      }
    );
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const price = data?.stellar?.usd;
      if (typeof price === "number" && price > 0) {
        cachedPrice = {
          price,
          updatedAt: new Date().toISOString(),
          source: "coingecko",
        };
        lastFetchTime = now;
        return NextResponse.json({
          success: true,
          ...cachedPrice,
        });
      }
    }
  } catch {
    // Fallback on network or timeout failure
  }

  if (cachedPrice) {
    return NextResponse.json({
      success: true,
      ...cachedPrice,
      stale: true,
    });
  }

  return NextResponse.json({
    success: true,
    price: 0.12,
    updatedAt: new Date().toISOString(),
    source: "fallback",
  });
}
