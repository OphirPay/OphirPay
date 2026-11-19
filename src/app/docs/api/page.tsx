// SPDX-License-Identifier: MIT

import type { Metadata } from "next";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { ApiDocsClient, type OpenApiSpecData } from "./ApiDocsClient";

export const metadata: Metadata = {
  title: "Interactive API Documentation — OpenAPI & Scalar Explorer",
  description:
    "Interactive OpenAPI reference and live testing playground for the OphirPay Stellar payments orchestration API. Test endpoints against Stellar Testnet nodes with full CSP compliance.",
};

export default function ApiDocsPage() {
  let spec: OpenApiSpecData | null = null;

  try {
    const specPath = join(process.cwd(), "docs", "openapi.yaml");
    if (existsSync(specPath)) {
      const rawYaml = readFileSync(specPath, "utf8");
      spec = load(rawYaml) as OpenApiSpecData;
    }
  } catch (err) {
    console.error("Failed to read docs/openapi.yaml on server:", err);
  }

  return <ApiDocsClient initialSpec={spec} />;
}
