// SPDX-License-Identifier: MIT

/**
 * CSRF enforcement coverage test.
 *
 * Guards against regression of the issue #191 fix: every route file that
 * exports a state-changing handler (POST/PATCH/PUT/DELETE) must invoke
 * `verifyCsrf`. A new mutation route added without CSRF protection fails CI.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MUTATING = ["POST", "PATCH", "PUT", "DELETE"];

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listRouteFiles(full));
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

describe("csrf enforcement on mutating routes", () => {
  const apiDir = join(__dirname, "../app/api");
  const routeFiles = listRouteFiles(apiDir);

  it("discovers route files", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  for (const file of routeFiles) {
    const rel = file.slice(file.indexOf("app/api"));
    const source = readFileSync(file, "utf-8");
    const methods = [...source.matchAll(/export async function (\w+)/g)]
      .map((m) => m[1])
      .filter((m) => MUTATING.includes(m));

    if (methods.length === 0) continue;

    it(`enforces CSRF in ${rel} [${methods.join(",")}]`, () => {
      expect(source).toMatch(/verifyCsrf/);
    });
  }
});
