// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

describe("Escrows and Streams Documentation & API Conformance", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const docPath = path.join(repoRoot, "docs/ESCROWS_AND_STREAMS.md");
  const openapiPath = path.join(repoRoot, "docs/openapi.yaml");
  const cookbookPath = path.join(repoRoot, "docs/API_COOKBOOK.md");
  const apiGuidePath = path.join(repoRoot, "docs/API_GUIDE.md");

  it("docs/ESCROWS_AND_STREAMS.md exists and is documented comprehensively", () => {
    expect(fs.existsSync(docPath)).toBe(true);
    const content = fs.readFileSync(docPath, "utf-8");
    expect(content.length).toBeGreaterThan(2000);
  });

  it("explicitly states the absence of a UI and links tracking issues #798 and #799", () => {
    const content = fs.readFileSync(docPath, "utf-8");
    expect(content).toMatch(/no\s+(frontend\s+)?UI\s+exists/i);
    expect(content).toMatch(/798/);
    expect(content).toMatch(/799/);
  });

  it("documents request and realistic response examples for all four HTTP endpoints", () => {
    const content = fs.readFileSync(docPath, "utf-8");

    // Escrow endpoints
    expect(content).toContain("/api/escrows");
    expect(content).toMatch(/GET\s+\/api\/escrows/);
    expect(content).toMatch(/POST\s+\/api\/escrows/);
    expect(content).toMatch(/\/api\/escrows\/\{id\}|\/api\/escrows\/\[id\]|\/api\/escrows\/1/);

    // Stream endpoints
    expect(content).toContain("/api/streams");
    expect(content).toMatch(/GET\s+\/api\/streams/);
    expect(content).toMatch(/POST\s+\/api\/streams/);
    expect(content).toMatch(/\/api\/streams\/\{id\}|\/api\/streams\/\[id\]|\/api\/streams\/3/);

    // POST returns 202 Accepted delegation
    expect(content).toMatch(/202\s+Accepted/);
  });

  it("documents state machines, arbiter role, and linear vesting formula", () => {
    const content = fs.readFileSync(docPath, "utf-8");

    // State machine terms
    expect(content).toMatch(/state\s+machine/i);
    expect(content).toMatch(/released/i);
    expect(content).toMatch(/claimed/i);
    expect(content).toMatch(/cancelled/i);

    // Arbiter role
    expect(content).toMatch(/arbiter/i);
    expect(content).toMatch(/dispute/i);

    // Linear vesting and LOCKED_BALANCE
    expect(content).toMatch(/linear(ly)?\s+vest/i);
    expect(content).toMatch(/LOCKED_BALANCE/);
  });

  it("documents the required Soroban contract error codes", () => {
    const content = fs.readFileSync(docPath, "utf-8");

    // Specific error codes from issue description
    expect(content).toMatch(/EscrowAlreadyReleased/);
    expect(content).toMatch(/StreamFullyClaimed/);
    expect(content).toMatch(/Unauthorized/);
    expect(content).toMatch(/EscrowNotDue/);
    expect(content).toMatch(/StreamAlreadyCancelled/);
    expect(content).toMatch(/StreamNotStarted/);
  });

  it("ensures openapi.yaml declares accurate schemas, methods and examples for escrows and streams", () => {
    const openapiRaw = fs.readFileSync(openapiPath, "utf-8");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec = yaml.load(openapiRaw) as any;

    expect(spec.paths["/api/escrows"]).toBeDefined();
    expect(spec.paths["/api/escrows"].get).toBeDefined();
    expect(spec.paths["/api/escrows"].post).toBeDefined();
    expect(spec.paths["/api/escrows"].post.responses["202"]).toBeDefined();

    expect(spec.paths["/api/escrows/{id}"]).toBeDefined();
    expect(spec.paths["/api/escrows/{id}"].get).toBeDefined();

    expect(spec.paths["/api/streams"]).toBeDefined();
    expect(spec.paths["/api/streams"].get).toBeDefined();
    expect(spec.paths["/api/streams"].post).toBeDefined();
    expect(spec.paths["/api/streams"].post.responses["202"]).toBeDefined();

    expect(spec.paths["/api/streams/{id}"]).toBeDefined();
    expect(spec.paths["/api/streams/{id}"].get).toBeDefined();
  });

  it("cross-links ESCROWS_AND_STREAMS.md from API_COOKBOOK.md and API_GUIDE.md", () => {
    const cookbook = fs.readFileSync(cookbookPath, "utf-8");
    const guide = fs.readFileSync(apiGuidePath, "utf-8");

    expect(cookbook).toContain("ESCROWS_AND_STREAMS.md");
    expect(guide).toContain("ESCROWS_AND_STREAMS.md");
  });
});
