// SPDX-License-Identifier: MIT

/**
 * Issue #1329 — Dockerfile builder stage must declare ARG + ENV for every
 * `NEXT_PUBLIC_*` variable documented in `.env.example`, with testnet defaults
 * matching `.env.example`, so images built via `docker build` inline the
 * expected network, RPC, Horizon, contract ID, and app URL values into the
 * Next.js client bundle.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");
const envExample = readFileSync(join(repoRoot, ".env.example"), "utf8");
const deploymentDoc = readFileSync(
  join(repoRoot, "docs", "DEPLOYMENT.md"),
  "utf8",
);

// Extract builder stage from Dockerfile
const builderStageMatch = dockerfile.match(
  /FROM\s+\S+\s+AS\s+builder([\s\S]*?)FROM\s+\S+\s+AS\s+runner/,
);
const builderStage = builderStageMatch ? builderStageMatch[1] : "";

// All NEXT_PUBLIC_* variables documented in .env.example (commented or uncommented)
const documentedNextPublicVars = new Set(
  Array.from(
    envExample.matchAll(/^\s*#?\s*(NEXT_PUBLIC_[A-Z0-9_]*)=/gm),
    (match) => match[1],
  ),
);

// Required (uncommented) NEXT_PUBLIC_* variables and their testnet defaults in .env.example
const requiredNextPublicDefaults = new Map(
  Array.from(
    envExample.matchAll(/^(NEXT_PUBLIC_[A-Z0-9_]*)=(.*)$/gm),
    (match) => [match[1], match[2].trim()],
  ),
);

describe("Dockerfile NEXT_PUBLIC_* build args (#1329)", () => {
  it("extracts the builder stage before the runner stage", () => {
    expect(builderStage.length).toBeGreaterThan(0);
    expect(builderStage).toContain("RUN npm run build");
  });

  it.each(Array.from(documentedNextPublicVars))(
    "declares ARG and ENV for %s in the builder stage before `npm run build`",
    (varName) => {
      const buildIndex = builderStage.indexOf("RUN npm run build");
      const beforeBuild = builderStage.slice(0, buildIndex);

      expect(beforeBuild).toMatch(new RegExp(`^ARG\\s+${varName}=`, "m"));
      expect(beforeBuild).toMatch(
        new RegExp(`\\b${varName}=\\$${varName}\\b`),
      );
    },
  );

  it.each(Array.from(requiredNextPublicDefaults.entries()))(
    "sets the .env.example testnet default for %s",
    (varName, expectedDefault) => {
      const argMatch = builderStage.match(
        new RegExp(`^ARG\\s+${varName}=(.*)$`, "m"),
      );
      expect(argMatch).not.toBeNull();
      const rawDefault = (argMatch?.[1] ?? "").trim().replace(/^""$/, "");
      expect(rawDefault).toBe(expectedDefault);
    },
  );

  it("documents NEXT_PUBLIC_* --build-arg usage for staging images in docs/DEPLOYMENT.md", () => {
    expect(deploymentDoc).toContain("--build-arg NEXT_PUBLIC_STELLAR_NETWORK=");
    expect(deploymentDoc).toContain("--build-arg NEXT_PUBLIC_CONTRACT_ID=");
    expect(deploymentDoc).toContain(
      "--build-arg NEXT_PUBLIC_EMITTER_CONTRACT_ID=",
    );
    expect(deploymentDoc).toContain("--build-arg NEXT_PUBLIC_APP_URL=");
    expect(deploymentDoc).toMatch(/staging/i);
  });
});
