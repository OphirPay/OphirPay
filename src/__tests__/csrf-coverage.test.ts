// SPDX-License-Identifier: MIT
/**
 * CSRF coverage + registry drift guard — issues #563, #704
 *
 * Acceptance criteria:
 *   1. Every mutating handler discovered under src/app/api is accounted for —
 *      either registered in MUTATING_ROUTES or explicitly allowlisted in
 *      CSRF_EXEMPT_ROUTES with a reason.
 *   2. Adding an unregistered mutating route fails with an actionable message
 *      naming the route and the exact registry entry to add (#704).
 *   3. Each registered route module imports verifyCsrf and calls it once per
 *      mutating handler.
 *   4. Browser sessions require a valid double-submit token; API keys bypass.
 *
 * The old guard only checked the *registered* entries, so a new route could
 * ship unregistered and the suite stayed green. This version discovers the
 * handlers on disk first and then reconciles them against the registry union.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  MUTATING_ROUTES,
  CSRF_EXEMPT_ROUTES,
  type CsrfRouteEntry,
  type CsrfExemptRoute,
} from "@/lib/csrf-route-registry";

const API_ROOT = path.join(process.cwd(), "src/app/api");

const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
type MutatingMethod = (typeof MUTATING_METHODS)[number];

interface DiscoveredHandler {
  method: MutatingMethod;
  path: string;
  file: string;
}

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

/**
 * Extract every exported mutating HTTP method from a route module.
 *
 * Handles the three forms Next.js accepts — `export const POST`, `export
 * function POST` / `export async function POST`, and the re-export form
 * `export { handler as POST }` — so a handler cannot dodge the guard by
 * changing how it is declared.
 */
function extractMutatingMethods(source: string): MutatingMethod[] {
  const found = new Set<MutatingMethod>();

  const declarationPatterns = [
    /export\s+(?:const|let|var)\s+(POST|PUT|PATCH|DELETE)\b/g,
    /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/g,
  ];
  for (const pattern of declarationPatterns) {
    for (const match of source.matchAll(pattern)) {
      found.add(match[1] as MutatingMethod);
    }
  }

  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of block[1]!.split(",")) {
      const [local, exported] = part.trim().split(/\s+as\s+/);
      const name = (exported ?? local)?.trim();
      if (name && (MUTATING_METHODS as readonly string[]).includes(name)) {
        found.add(name as MutatingMethod);
      }
    }
  }

  return [...found];
}

function discoverHandlers(): DiscoveredHandler[] {
  const handlers: DiscoveredHandler[] = [];
  for (const rel of findRouteFiles(API_ROOT)) {
    const source = fs.readFileSync(path.join(API_ROOT, rel), "utf8");
    const apiPath = "/api/" + rel.replace(/\/route\.ts$/, "");
    for (const method of extractMutatingMethods(source)) {
      handlers.push({ method, path: apiPath, file: `src/app/api/${rel}` });
    }
  }
  return handlers;
}

/**
 * Build the actionable failure message for a handler that is neither
 * registered nor allowlisted. Kept as a pure function so the guard itself is
 * unit-tested (see the "drift guard" describe block).
 */
function unaccountedMessage(handler: DiscoveredHandler): string {
  const routeFile = handler.file.replace(/^src\/app\/api\//, "");
  const entry: CsrfRouteEntry = {
    method: handler.method,
    path: handler.path,
    routeFile,
    description: "<what this handler does>",
  };
  return [
    `Unregistered mutating route ${handler.method} ${handler.path} (${handler.file}).`,
    `Add it to MUTATING_ROUTES in src/lib/csrf-route-registry.ts:`,
    `  ${JSON.stringify(entry)},`,
    `or, if it authenticates with a shared secret instead of a browser session,`,
    `add it to CSRF_EXEMPT_ROUTES with a reason.`,
  ].join("\n");
}

function findUnaccounted(
  discovered: DiscoveredHandler[],
  registered: CsrfRouteEntry[],
  exempt: CsrfExemptRoute[]
): DiscoveredHandler[] {
  const known = new Set<string>();
  for (const entry of [...registered, ...exempt]) {
    known.add(`${entry.method} ${entry.path}`);
  }
  return discovered.filter((h) => !known.has(`${h.method} ${h.path}`));
}

const registeredIndex = new Set(
  MUTATING_ROUTES.map((r) => `${r.method} ${r.path}`)
);

describe("CSRF coverage + registry drift guard (issues #563, #704)", () => {
  describe("Drift guard — every mutating handler is accounted for", () => {
    it("discovers at least 25 mutating handlers on disk", () => {
      expect(discoverHandlers().length).toBeGreaterThanOrEqual(25);
    });

    it("accounts for every mutating handler via the registry or the allowlist", () => {
      const unaccounted = findUnaccounted(
        discoverHandlers(),
        MUTATING_ROUTES,
        CSRF_EXEMPT_ROUTES
      );
      const message =
        unaccounted.length > 0
          ? "\n" + unaccounted.map(unaccountedMessage).join("\n\n") + "\n"
          : "";
      expect(unaccounted, message).toEqual([]);
    });

    it("fails with an actionable entry when a new route is added unregistered", () => {
      // Positive control: the guard must reject a synthetic handler that is in
      // neither list, and the message must name the route + the entry to add.
      const synthetic: DiscoveredHandler = {
        method: "POST",
        path: "/api/example/new",
        file: "src/app/api/example/new/route.ts",
      };
      const unaccounted = findUnaccounted(
        [synthetic],
        MUTATING_ROUTES,
        CSRF_EXEMPT_ROUTES
      );
      expect(unaccounted).toEqual([synthetic]);

      const message = unaccountedMessage(synthetic);
      expect(message).toContain("POST /api/example/new");
      expect(message).toContain('"routeFile":"example/new/route.ts"');
      expect(message).toContain("MUTATING_ROUTES");
      expect(message).toContain("CSRF_EXEMPT_ROUTES");
    });
  });

  describe("Registry integrity", () => {
    it("has no duplicate entries in either list", () => {
      const registered = MUTATING_ROUTES.map((r) => `${r.method} ${r.path}`);
      expect(new Set(registered).size).toBe(registered.length);

      const exempt = CSRF_EXEMPT_ROUTES.map((r) => `${r.method} ${r.path}`);
      expect(new Set(exempt).size).toBe(exempt.length);
    });

    it("never registers and allowlists the same route", () => {
      for (const entry of CSRF_EXEMPT_ROUTES) {
        expect(
          registeredIndex.has(`${entry.method} ${entry.path}`),
          `${entry.method} ${entry.path} is both registered and allowlisted`
        ).toBe(false);
      }
    });

    it("gives every allowlisted route a real reason", () => {
      for (const entry of CSRF_EXEMPT_ROUTES) {
        expect(
          entry.reason.length,
          `allowlisted ${entry.method} ${entry.path} needs a reason`
        ).toBeGreaterThan(10);
      }
    });

    it("every registry/allowlist entry points at an existing route file", () => {
      for (const entry of [...MUTATING_ROUTES, ...CSRF_EXEMPT_ROUTES]) {
        const full = path.join(API_ROOT, entry.routeFile);
        expect(fs.existsSync(full), `missing route file: ${entry.routeFile}`).toBe(true);
      }
    });

    it("every registered path starts with /api/", () => {
      for (const route of MUTATING_ROUTES) {
        expect(route.path.startsWith("/api/")).toBe(true);
      }
    });

    it("covers auth, payments, governance, multisig and webhooks", () => {
      const prefixes = [
        "/api/auth/",
        "/api/payments",
        "/api/governance/",
        "/api/multisig",
        "/api/webhooks",
      ];
      for (const prefix of prefixes) {
        expect(MUTATING_ROUTES.some((r) => r.path.startsWith(prefix))).toBe(true);
      }
    });

    it("allowlists the scheduler/cron endpoints that authenticate by secret", () => {
      const paths = CSRF_EXEMPT_ROUTES.map((r) => r.path);
      expect(paths).toContain("/api/cron");
      expect(paths).toContain("/api/scheduled/run");
      expect(paths).toContain("/api/jobs/process-due-recurring");
    });
  });

  describe("Per-route verifyCsrf enforcement", () => {
    const uniqueFiles = [...new Set(MUTATING_ROUTES.map((r) => r.routeFile))];

    for (const routeFile of uniqueFiles) {
      it(`${routeFile} calls verifyCsrf once per mutating handler`, () => {
        const full = path.join(API_ROOT, routeFile);
        expect(fs.existsSync(full), `missing route file: ${routeFile}`).toBe(true);
        const source = fs.readFileSync(full, "utf8");
        expect(source).toContain('from "@/lib/csrf"');

        const handlers = extractMutatingMethods(source).length;
        const calls = (source.match(/verifyCsrf\s*\(\s*request\s*\)/g) ?? []).length;
        expect(calls).toBeGreaterThanOrEqual(handlers);
      });
    }
  });
});
