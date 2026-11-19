// SPDX-License-Identifier: MIT
/**
 * Tests for docker-compose.yml and docker-compose.dev.yml (issue #1340).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("docker-compose.yml (issue #1340)", () => {
  it("drops the obsolete top-level version key", () => {
    const raw = read("docker-compose.yml");
    const parsed = load(raw) as Record<string, unknown>;
    expect(parsed.version).toBeUndefined();
  });

  it("configures the app service for production without source bind mounts", () => {
    const raw = read("docker-compose.yml");
    const parsed = load(raw) as {
      services: {
        app: {
          environment: string[];
          volumes?: string[];
          healthcheck?: { test: string[] };
        };
      };
    };

    expect(parsed.services.app).toBeDefined();
    expect(parsed.services.app.environment).toContain("NODE_ENV=production");
    // No bind mounts over the standalone image
    expect(parsed.services.app.volumes).toBeUndefined();
    expect(parsed.services.app.healthcheck).toBeDefined();
  });
});

describe("docker-compose.dev.yml (issue #1340)", () => {
  it("exists and defines a development variant with hot reload", () => {
    expect(existsSync(path.join(ROOT, "docker-compose.dev.yml"))).toBe(true);

    const raw = read("docker-compose.dev.yml");
    const parsed = load(raw) as {
      services: {
        app: {
          command: string;
          environment: string[];
          volumes: string[];
        };
      };
    };

    expect(parsed.services.app.command).toBe("npm run dev");
    expect(parsed.services.app.environment).toContain("NODE_ENV=development");
    expect(parsed.services.app.volumes).toContain(".:/app");
  });
});
