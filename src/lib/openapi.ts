// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import {
  STELLAR_TESTNET_ENV,
  type OpenApiDocument,
  type OpenApiServer,
} from "@/lib/openapi-schema";

export * from "@/lib/openapi-schema";

let cachedSpec: OpenApiDocument | null = null;

/**
 * Load and parse `docs/openapi.yaml` into an OpenAPI 3.1 JSON document
 * enriched with Stellar Testnet server metadata for interactive "Try it out".
 */
export function getOpenApiSpec(forceReload = false): OpenApiDocument {
  if (cachedSpec && !forceReload) {
    return cachedSpec;
  }

  const specPath = join(process.cwd(), "docs", "openapi.yaml");
  const rawYaml = readFileSync(specPath, "utf8");
  const parsed = load(rawYaml) as OpenApiDocument;

  if (!parsed || typeof parsed !== "object" || !parsed.openapi || !parsed.paths) {
    throw new Error("Invalid OpenAPI document in docs/openapi.yaml");
  }

  const existingServers = Array.isArray(parsed.servers) ? [...parsed.servers] : [];
  const hasTestnetServer = existingServers.some(
    (s) =>
      s.description?.toLowerCase().includes("testnet") ||
      s["x-stellar-network"] === "testnet"
  );

  const servers: OpenApiServer[] = hasTestnetServer
    ? existingServers
    : [
        {
          url: STELLAR_TESTNET_ENV.defaultServerUrl,
          description: "Stellar Testnet (Local Development Gateway)",
          "x-stellar-network": STELLAR_TESTNET_ENV.network,
          "x-horizon-url": STELLAR_TESTNET_ENV.horizonUrl,
          "x-soroban-rpc-url": STELLAR_TESTNET_ENV.sorobanRpcUrl,
        },
        {
          url: STELLAR_TESTNET_ENV.testnetGatewayUrl,
          description: "Stellar Testnet API Environment",
          "x-stellar-network": STELLAR_TESTNET_ENV.network,
          "x-horizon-url": STELLAR_TESTNET_ENV.horizonUrl,
          "x-soroban-rpc-url": STELLAR_TESTNET_ENV.sorobanRpcUrl,
        },
        ...existingServers.filter((s) => s.url !== STELLAR_TESTNET_ENV.defaultServerUrl),
      ];

  cachedSpec = {
    ...parsed,
    servers,
    "x-stellar-environment": STELLAR_TESTNET_ENV,
  };

  return cachedSpec;
}
