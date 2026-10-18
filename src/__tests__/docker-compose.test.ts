// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1340: docker-compose app service mounts the repo over the
 * standalone image and cannot start.
 *
 * Validates that:
 * 1. docker-compose.yml drops the obsolete top-level `version:` key.
 * 2. docker-compose.yml sets `NODE_ENV=production` for the standalone app.
 * 3. Default app service in docker-compose.yml has NO host bind mounts over /app.
 * 4. docker-compose.dev.yml exists as an opt-in overlay for development hot-reloading.
 * 5. docker-smoke.yml runs docker compose up for the app service.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("docker-compose.yml configuration (issue #1340)", () => {
  const compose = load(read("docker-compose.yml")) as Record<string, unknown> & {
    services: {
      app: {
        image?: string;
        environment: string[];
        volumes?: string[];
        healthcheck: { test: string[]; interval: string; start_period: string };
      };
      db: Record<string, unknown>;
      redis: Record<string, unknown>;
    };
  };

  it("drops the obsolete top-level version key", () => {
    expect(compose.version).toBeUndefined();
  });

  it("defines app, db, and redis services", () => {
    expect(compose.services).toBeDefined();
    expect(compose.services.app).toBeDefined();
    expect(compose.services.db).toBeDefined();
    expect(compose.services.redis).toBeDefined();
  });

  it("configures NODE_ENV=production for the production standalone runner", () => {
    expect(compose.services.app.environment).toContain("NODE_ENV=production");
    expect(compose.services.app.environment).not.toContain("NODE_ENV=development");
  });

  it("does not mount host repository over /app in default compose", () => {
    const volumes = compose.services.app.volumes;
    if (volumes) {
      expect(volumes).not.toContain(".:/app");
    }
  });

  it("maintains the liveness healthcheck for orchestrator verification", () => {
    const healthcheck = compose.services.app.healthcheck;
    expect(healthcheck).toBeDefined();
    expect(healthcheck.test[0]).toBe("CMD");
    expect(healthcheck.test.join(" ")).toContain("/api/health/live");
  });
});

describe("docker-compose.dev.yml overlay (issue #1340)", () => {
  const devCompose = load(read("docker-compose.dev.yml")) as {
    services: {
      app: {
        environment: string[];
        volumes: string[];
      };
    };
  };

  it("parses as valid YAML and defines the app overlay", () => {
    expect(devCompose.services.app).toBeDefined();
  });

  it("sets NODE_ENV=development and includes host bind mounts for hot-reload", () => {
    expect(devCompose.services.app.environment).toContain("NODE_ENV=development");
    expect(devCompose.services.app.volumes).toContain(".:/app");
  });
});

describe("docker-smoke.yml workflow integration (issue #1340)", () => {
  it("exercises the compose app service in CI", () => {
    const workflow = read(".github/workflows/docker-smoke.yml");
    expect(workflow).toMatch(/docker compose.*up -d app/);
    expect(workflow).toMatch(/docker compose.*logs app/);
  });
});
