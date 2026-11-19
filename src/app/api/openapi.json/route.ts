// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { apiRoute } from "@/lib/api-route";

let cachedSpec: unknown = null;

function getOpenApiSpec(): unknown {
  if (!cachedSpec) {
    const specPath = join(process.cwd(), "docs", "openapi.yaml");
    const rawYaml = readFileSync(specPath, "utf8");
    cachedSpec = load(rawYaml);
  }
  return cachedSpec;
}

/**
 * OpenAPI JSON specification endpoint — `GET /api/openapi.json`.
 *
 * Serves the machine-readable OpenAPI 3.1.0 document parsed from `docs/openapi.yaml`.
 * Consumed by the interactive documentation route at `/docs/api`, SDK generators,
 * external API gateways, and testing tools.
 */
export const GET = apiRoute(
  {
    name: "GET /api/openapi.json",
    auth: "opt-out",
    csrf: "opt-out",
  },
  async () => {
    const spec = getOpenApiSpec();
    return NextResponse.json(spec, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  }
);
