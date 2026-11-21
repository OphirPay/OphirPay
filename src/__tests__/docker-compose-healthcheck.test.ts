// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";

import { describe, expect,it } from "vitest";

describe("Docker Compose Healthcheck & Readiness Gates (Issue #2027)", () => {
  const devComposePath = path.resolve(__dirname, "../../docker-compose.dev.yml");
  const prodComposePath = path.resolve(__dirname, "../../docker-compose.yml");
  const probeScriptPath = path.resolve(__dirname, "../../scripts/container-healthcheck.sh");

  it("verifies docker-compose.dev.yml defines healthchecks on db and redis", () => {
    const content = fs.readFileSync(devComposePath, "utf-8");

    // db service healthcheck
    expect(content).toMatch(/db:[\s\S]*?healthcheck:[\s\S]*?pg_isready/);

    // redis service healthcheck
    expect(content).toMatch(/redis:[\s\S]*?healthcheck:[\s\S]*?redis-cli/);
  });

  it("verifies docker-compose.dev.yml defines service_healthy conditions for app dependencies", () => {
    const content = fs.readFileSync(devComposePath, "utf-8");

    expect(content).toMatch(/db:\s*\n\s*condition:\s*service_healthy/);
    expect(content).toMatch(/redis:\s*\n\s*condition:\s*service_healthy/);
  });

  it("verifies docker-compose.dev.yml defines app healthcheck probe", () => {
    const content = fs.readFileSync(devComposePath, "utf-8");

    expect(content).toMatch(/app:[\s\S]*?healthcheck:/);
    expect(content).toContain("scripts/container-healthcheck.sh");
  });

  it("verifies docker-compose.yml defines healthchecks and service_healthy dependencies", () => {
    const content = fs.readFileSync(prodComposePath, "utf-8");

    expect(content).toMatch(/db:\s*\n\s*condition:\s*service_healthy/);
    expect(content).toMatch(/redis:\s*\n\s*condition:\s*service_healthy/);
    expect(content).toMatch(/healthcheck:[\s\S]*?pg_isready/);
    expect(content).toMatch(/healthcheck:[\s\S]*?redis-cli/);
    expect(content).toMatch(/healthcheck:[\s\S]*?scripts\/healthcheck\.js/);
  });

  it("verifies scripts/container-healthcheck.sh supports curl, wget, and node fallback", () => {
    expect(fs.existsSync(probeScriptPath)).toBe(true);
    const script = fs.readFileSync(probeScriptPath, "utf-8");

    expect(script).toContain("curl");
    expect(script).toContain("wget");
    expect(script).toContain("scripts/healthcheck.js");
  });
});
