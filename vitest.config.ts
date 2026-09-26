import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Tests are collected only from the sanctioned test roots. A narrow glob
    // means a stray `*.test.ts` colocated inside shipped source (src/lib,
    // src/app, …) can no longer be collected silently. `src/__tests__` is the
    // documented convention (see docs/API_GUIDE.md → "Testing your endpoint");
    // `scripts` holds unit tests for build tooling and `tests` is reserved for
    // non-Vitest (Playwright) suites.
    // Guarded against regression by src/__tests__/repo-hygiene.test.ts.
    include: [
      "src/__tests__/**/*.test.{ts,tsx}",
      "scripts/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
    ],
    env: {
      NEXT_PUBLIC_CONTRACT_ID: "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET",
      NEXT_PUBLIC_EMITTER_CONTRACT_ID: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
      NEXT_PUBLIC_CHAIN_READ_SOURCE: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
    },
    coverage: {
      provider: "v8",
      //
      // ── Measured surface (issues #712 / #713) ───────────────────────────
      //
      // The include list is the four top-level source trees, each named once.
      // Route handlers already live under `src/app/api/**`, so `src/app/**`
      // covers them without a second, overlapping entry — every file is
      // measured exactly once so the numbers stay interpretable.
      //
      include: [
        "src/lib/**", // shared logic (API, security, formatting, webhooks)
        "src/components/**", // ui/ primitives + domain components
        "src/hooks/**", // React hooks
        "src/app/**", // pages, layouts, route handlers, metadata routes
      ],
      //
      // Exclusions are deliberate and each group carries its reason. Anything
      // not listed here is expected to be measured.
      //
      exclude: [
        "src/__tests__/**",
        // Defensive: a test file must never be measured as production source,
        // whichever root it is collected from. `coverage.include` covers
        // `src/lib/**`, so this keeps a future colocated test from re-entering
        // the production coverage denominator (#688).
        "**/*.test.{ts,tsx}",
        "src/types/**", // Types
        "**/*.d.ts", // Types
        "src/lib/wallets/**", // Browser-only
        "src/lib/index.ts", // Re-export index
        "src/lib/contracts.ts", // E2E-only
        "src/lib/contract-advanced.ts", // E2E-only
        "src/lib/contract-events.ts", // E2E-only
        "src/lib/stellar.ts", // E2E-only
        "src/lib/rpc-failover.ts", // E2E-only
        "src/lib/events/event-source.ts", // E2E-only
        // Sharded database support is exercised by the Playwright E2E suite;
        // excluding its in-memory fixtures keeps unit coverage meaningful.
        "src/lib/db/sharded-test-fixture.ts", // E2E-only
        // NOTE (#700): api-auth.ts, rate-limit.ts, webhook-dispatcher.ts and
        // webhook-deliver.ts are deliberately NOT excluded — they authenticate
        // API calls, enforce rate limits and sign/deliver webhooks, so they are
        // exactly what the coverage figure must speak to. They are wired to
        // src/__tests__/{auth,api-scopes,rate-limit-redis,webhook-deliver,
        // webhook-dispatcher}.test.ts instead.
        "src/lib/api-client.ts", // E2E-only
        "src/lib/demo-mode.ts", // E2E-only
        "src/instrumentation.ts", // Next.js entrypoint
        "src/lib/startup.ts", // Next.js entrypoint
        "src/lib/sentry.ts", // 3rd party integration
        "src/lib/deploy-verify.ts", // E2E-only
        "src/hooks/useMultiWallet.tsx", // Browser-only
        "src/hooks/useFreighter.tsx", // Browser-only
        "src/hooks/useTheme.tsx", // Browser-only
        "src/hooks/useRetry.ts", // Browser-only
        "src/hooks/useApiQuery.ts", // Browser-only
        "src/hooks/useNetworkChange.ts", // Browser-only
        "src/hooks/useErrorTracker.ts", // Browser-only
        "src/hooks/useKeyboardShortcuts.ts", // Browser-only
        "src/hooks/useLocalStorage.ts", // Browser-only
        "src/lib/ab-test.ts", // E2E-only
        "src/lib/address-book.ts", // Browser-only
        "src/lib/api-cache.ts", // E2E-only
        "src/lib/audit.ts", // E2E-only
        "src/lib/batch-validator.ts", // E2E-only
        "src/lib/chart-data.ts", // E2E-only
        "src/lib/client-auth.ts", // E2E-only
        "src/lib/client-version.ts", // E2E-only
        "src/lib/csv-import.ts", // Browser-only
        "src/lib/payment-link.ts", // E2E-only
        "src/lib/prisma-logger.ts", // E2E-only
        "src/lib/query-params.ts", // Browser-only
        "src/lib/soft-delete.ts", // E2E-only
        "src/components/ui/index.ts", // Re-export index
        "src/hooks/index.ts", // Re-export index
        "src/lib/test-factory.ts", // Test utilities
        "src/lib/time.ts", // Browser-only
        "src/lib/trustline.ts", // E2E-only
        "src/lib/version-script.ts", // Build script
        "src/lib/web-vitals.ts", // 3rd party integration
      ],
      //
      // ── Per-directory coverage budgets (issue #714) ─────────────────────
      //
      // One global 80% threshold was simultaneously too strict for thin,
      // presentational surface area and too lenient for the money-handling
      // API and security modules: a well-covered component could subsidise a
      // thinly-covered auth or webhook module and keep the aggregate green.
      //
      // Instead there are three documented bands. A file must clear *every*
      // band whose glob it matches, so the strictest band wins — that is what
      // makes a security module's budget bite even though it also sits inside
      // the broader `src/lib/**` band.
      //
      //   1. API & security  — highest bar (auth, CSRF, sessions, sanitisation)
      //   2. lib logic       — shared, mostly-pure business logic
      //   3. UI floor        — components, hooks and pages; an explicit floor,
      //                        not a target
      //
      // The numbers are set at (or a point or two below) the measured baseline
      // recorded in CONTRIBUTING.md. They only ever go up — see the "Coverage
      // ratchet" section there.
      //
      thresholds: {
        // ── Global floor ───────────────────────────────────────────────────
        // Baseline: 69.8% st / 66.4% br / 67.1% fn / 71.3% ln.
        statements: 69,
        branches: 66,
        functions: 66,
        lines: 71,

        // ── Band 1 · API route handlers (money-handling) ───────────────────
        // Baseline: 71.3% st / 68.9% br / 70.4% fn / 74.4% ln.
        "src/app/api/**": {
          statements: 71,
          branches: 68,
          functions: 70,
          lines: 74,
        },

        // ── Band 1 · security modules ──────────────────────────────────────
        // Auth, CSRF, session, crypto, sanitisation and webhook-URL guarding.
        // Baseline (aggregate): 90.4% st / 90.1% br / 94.1% fn / 92.5% ln.
        "src/lib/{auth-rate-limit,auth-session,challenge,csrf,csrf-route-registry,crypto,lookup-rate-limit,sanitize,session,validation-schemas,webhook-url-guard}.ts":
          {
            statements: 90,
            branches: 89,
            functions: 93,
            lines: 92,
          },

        // ── Band 2 · shared lib logic ──────────────────────────────────────
        // Baseline: 87.8% st / 84.7% br / 91.2% fn / 89.2% ln.
        "src/lib/**": {
          statements: 87,
          branches: 84,
          functions: 90,
          lines: 89,
        },

        // ── Band 3 · UI components (primitive + domain) ────────────────────
        // Baseline: 70.4% st / 75.0% br / 69.1% fn / 71.5% ln.
        "src/components/**": {
          statements: 70,
          branches: 74,
          functions: 69,
          lines: 71,
        },

        // ── Band 3 · hooks ─────────────────────────────────────────────────
        // Baseline (post-#712): 95.3% st / 82.5% br / 95.7% fn / 97.1% ln.
        "src/hooks/**": {
          statements: 95,
          branches: 82,
          functions: 95,
          lines: 97,
        },

        // ── Band 3 · app pages / layouts ───────────────────────────────────
        // The page surface is the thinnest tier; the floor is explicit so it
        // can only move up. Baseline for the whole glob (pages + route
        // handlers): 55.2% st / 52.5% br / 43.6% fn / 56.9% ln. (This glob
        // also matches `src/app/api/**`, whose Band 1 budget is strictly
        // higher and therefore binding for those files.)
        "src/app/**": {
          statements: 55,
          branches: 52,
          functions: 43,
          lines: 56,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
