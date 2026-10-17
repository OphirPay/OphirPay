import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

describe("Docker Compose Configuration (Issue #1340)", () => {
  const rootDir = process.cwd();
  const composePath = join(rootDir, "docker-compose.yml");
  const devComposePath = join(rootDir, "docker-compose.dev.yml");
  const workflowPath = join(rootDir, ".github/workflows/docker-smoke.yml");

  describe("Production docker-compose.yml", () => {
    it("exists and is valid YAML", () => {
      expect(existsSync(composePath)).toBe(true);
      const raw = readFileSync(composePath, "utf-8");
      expect(() => YAML.parse(raw)).not.toThrow();
    });

    it("drops the obsolete top-level version key", () => {
      const raw = readFileSync(composePath, "utf-8");
      const doc = YAML.parse(raw);
      expect(doc.version).toBeUndefined();
    });

    it("configures the app service for production without host source bind mounts", () => {
      const raw = readFileSync(composePath, "utf-8");
      const doc = YAML.parse(raw);
      const app = doc.services?.app;

      expect(app).toBeDefined();

      // Check environment has NODE_ENV=production
      const envList = Array.isArray(app.environment)
        ? app.environment
        : Object.entries(app.environment || {}).map(([k, v]) => `${k}=${v}`);
      expect(envList).toContain("NODE_ENV=production");

      // Verify that NO host checkout volume is mounted over /app
      const volumes = app.volumes || [];
      const mountsRoot = volumes.some((v: string) => {
        const parts = typeof v === "string" ? v.split(":") : [];
        return parts[0] === "." || parts[1] === "/app";
      });
      expect(mountsRoot).toBe(false);
    });

    it("preserves health dependencies and liveness healthcheck", () => {
      const raw = readFileSync(composePath, "utf-8");
      const doc = YAML.parse(raw);
      const app = doc.services?.app;

      expect(app.depends_on?.db?.condition).toBe("service_healthy");
      expect(app.depends_on?.redis?.condition).toBe("service_healthy");
      expect(app.healthcheck).toBeDefined();

      const testCmd = Array.isArray(app.healthcheck.test)
        ? app.healthcheck.test.join(" ")
        : String(app.healthcheck.test);
      expect(testCmd).toContain("/api/health/live");
    });
  });

  describe("Development docker-compose.dev.yml", () => {
    it("exists and is valid YAML", () => {
      expect(existsSync(devComposePath)).toBe(true);
      const raw = readFileSync(devComposePath, "utf-8");
      expect(() => YAML.parse(raw)).not.toThrow();
    });

    it("configures development hot reload with host source mounts and next dev", () => {
      const raw = readFileSync(devComposePath, "utf-8");
      const doc = YAML.parse(raw);
      const app = doc.services?.app;

      expect(app).toBeDefined();

      const envList = Array.isArray(app.environment)
        ? app.environment
        : Object.entries(app.environment || {}).map(([k, v]) => `${k}=${v}`);
      expect(envList).toContain("NODE_ENV=development");

      // Check command runs dev
      expect(app.command).toBe("npm run dev");

      // Check host checkout volume is mounted for hot reload
      const volumes = app.volumes || [];
      const mountsRoot = volumes.some((v: string) => {
        const parts = typeof v === "string" ? v.split(":") : [];
        return parts[0] === "." && parts[1] === "/app";
      });
      expect(mountsRoot).toBe(true);
    });
  });

  describe("Docker Smoke Workflow Integration", () => {
    it("includes docker-compose.dev.yml in change detection paths", () => {
      const raw = readFileSync(workflowPath, "utf-8");
      expect(raw).toContain('"docker-compose.dev.yml"');
    });

    it("exercises docker compose up for the app service", () => {
      const raw = readFileSync(workflowPath, "utf-8");
      expect(raw).toMatch(/docker compose.*up.*app/);
    });

    it("verifies the compose app service health status", () => {
      const raw = readFileSync(workflowPath, "utf-8");
      expect(raw).toMatch(/docker compose.*ps app/);
    });
  });
});
