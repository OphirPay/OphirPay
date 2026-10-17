// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1340 — docker-compose app service mounts the repo over the standalone
 * image and cannot start.
 *
 * Verifies:
 *   • `docker-compose.yml` omits the obsolete top-level `version` field, sets
 *     `NODE_ENV=production`, and does NOT mount `.:/app` over the standalone
 *     runner image (`/app/server.js`).
 *   • `docker-compose.dev.yml` provides the opt-in hot-reload development
 *     override (`target: deps`, `npm run dev`, `NODE_ENV=development`, and
 *     source bind mounts).
 *   • `docs/DEPLOYMENT.md` documents `docker-compose.dev.yml`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("docker-compose standalone vs dev split (issue #1340)", () => {
  it("docker-compose.yml runs the standalone production image without host bind mounts or obsolete version key", () => {
    const compose = load(read("docker-compose.yml")) as {
      version?: string;
      services: {
        app: {
          environment: string[];
          volumes?: string[];
        };
      };
    };

    expect(compose.version).toBeUndefined();
    expect(compose.services.app.environment).toContain("NODE_ENV=production");
    expect(compose.services.app.environment).not.toContain("NODE_ENV=development");
    expect(compose.services.app.volumes).toBeUndefined();
  });

  it("docker-compose.dev.yml provides hot-reload development mounts and next dev command", () => {
    const devCompose = load(read("docker-compose.dev.yml")) as {
      version?: string;
      services: {
        app: {
          build: { target: string };
          command: string[];
          environment: string[];
          volumes: string[];
        };
      };
    };

    expect(devCompose.version).toBeUndefined();
    expect(devCompose.services.app.build.target).toBe("deps");
    expect(devCompose.services.app.command).toEqual(["npm", "run", "dev"]);
    expect(devCompose.services.app.environment).toContain("NODE_ENV=development");
    expect(devCompose.services.app.volumes).toContain(".:/app");
  });

  it("documents docker-compose.dev.yml in docs/DEPLOYMENT.md", () => {
    const doc = read("docs/DEPLOYMENT.md");
    expect(doc).toContain("docker-compose.dev.yml");
  });
});
