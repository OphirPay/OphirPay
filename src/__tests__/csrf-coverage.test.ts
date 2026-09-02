// SPDX-License-Identifier: MIT
/**
 * CSRF coverage enforcement — Issue #563
 *
 * Acceptance criteria:
 *   1. Every mutating route is registered in csrf-route-registry.ts.
 *   2. Each route module imports verifyCsrf and calls it once per handler.
 *   3. Browser sessions require a valid double-submit token; API keys bypass CSRF.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { MUTATING_ROUTES } from "@/lib/csrf-route-registry";

const API_ROOT = path.join(process.cwd(), "src/app/api");

function findRouteFiles(dir: string, base = ""): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findRouteFiles(full, rel));
    } else if (entry.name === "route.ts") {
      files.push(rel.replace(/\\/g, "/"));
    }
  }
  return files;
}

function readRouteSource(routeFile: string): string {
  const fullPath = path.join(API_ROOT, routeFile);
  expect(fs.existsSync(fullPath), `missing route file: ${routeFile}`).toBe(true);
  return fs.readFileSync(fullPath, "utf8");
}

function countMutatingHandlers(source: string): number {
  const exported =
    (source.match(/export const (POST|PUT|PATCH|DELETE)\b/g) ?? []).length +
    (source.match(/export async function (POST|PUT|PATCH|DELETE)\b/g) ?? []).length;
  return exported;
}

function countVerifyCsrfCalls(source: string): number {
  return (source.match(/verifyCsrf\s*\(\s*request\s*\)/g) ?? []).length;
}

describe("CSRF coverage audit (issue #563)", () => {
  describe("Route registry", () => {
    it("lists every mutating handler discovered in src/app/api", () => {
      const routeFiles = findRouteFiles(API_ROOT);
      const discovered: { method: string; path: string; file: string }[] = [];

      for (const rel of routeFiles) {
        const source = fs.readFileSync(path.join(API_ROOT, rel), "utf8");
        const methods = [
          ...source.matchAll(/export const (POST|PUT|PATCH|DELETE)\b/g),
          ...source.matchAll(/export async function (POST|PUT|PATCH|DELETE)\b/g),
        ].map((m) => m[1]!);

        const apiPath =
          "/api/" +
          rel
            .replace(/\\/g, "/")
            .replace(/\/route\.ts$/, "")
            .replace(/\[([^\]]+)\]/g, "[$1]");

        for (const method of methods) {
          discovered.push({ method, path: apiPath, file: rel.replace(/\\/g, "/") });
        }
      }

      expect(MUTATING_ROUTES.length).toBe(discovered.length);

      for (const entry of discovered) {
        const registered = MUTATING_ROUTES.find(
          (r) => r.method === entry.method && r.path === entry.path,
        );
        expect(registered, `unregistered mutating route ${entry.method} ${entry.path}`).toBeDefined();
      }
    });

    it("has at least 25 mutating routes registered", () => {
      expect(MUTATING_ROUTES.length).toBeGreaterThanOrEqual(25);
    });

    it("every registry path starts with /api/", () => {
      for (const route of MUTATING_ROUTES) {
        expect(route.path.startsWith("/api/")).toBe(true);
      }
    });
  });

  describe("Per-route verifyCsrf enforcement", () => {
    const uniqueFiles = [...new Set(MUTATING_ROUTES.map((r) => r.routeFile))];

    for (const routeFile of uniqueFiles) {
      it(`${routeFile} calls verifyCsrf once per mutating handler`, () => {
        const source = readRouteSource(routeFile);
        expect(source).toContain('from "@/lib/csrf"');
        expect(countVerifyCsrfCalls(source)).toBeGreaterThanOrEqual(countMutatingHandlers(source));
      });
    }
  });

  describe("Registry ↔ filesystem consistency", () => {
    it("every registry entry points at an existing route file", () => {
      for (const route of MUTATING_ROUTES) {
        readRouteSource(route.routeFile);
      }
    });

    it("covers auth, payments, governance, multisig, webhooks, and jobs", () => {
      const prefixes = [
        "/api/auth/",
        "/api/payments",
        "/api/governance/",
        "/api/multisig",
        "/api/webhooks",
        "/api/jobs/",
      ];
      for (const prefix of prefixes) {
        expect(MUTATING_ROUTES.some((r) => r.path.startsWith(prefix))).toBe(true);
      }
    });
  });
});
