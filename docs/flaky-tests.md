# Flaky Test Process — OphirPay

Flaky tests burn contributor time and erode trust in CI. This document defines how OphirPay **marks**, **reports**, and **fixes** flaky tests.

## What is a flaky test?

A test that fails on one run and passes on the next run **without any code change**. Common causes:

- Timing-dependent assertions (race conditions, missing waits)
- Environment coupling (network, external services, DB state)
- Order-dependent tests (shared state leakage)
- Browser flakiness (animations, font loading, viewport)

## 1. Mark

Playwright is configured to **automatically retry** flaky tests in CI:

```ts
// playwright.config.ts
retries: process.env.CI ? 2 : 0,
trace: "on-first-retry", // capture trace of the failed first attempt
```

- A test that fails on the first attempt and passes on retry is **marked flaky** by CI.
- `trace: "on-first-retry"` preserves a trace of the failing attempt for debugging.
- Unit tests (Vitest) run with `--reporter=verbose` so failures are fully visible.

## 2. Report

After the E2E run, CI **annotates the pull request** automatically:

- `.github/workflows/ci.yml` → E2E job → "Annotate PR when flaky tests pass on retry"
- Parses `test-results.json`, finds tests with multiple attempts and final `ok` status
- Posts a comment on the PR listing every flaky test, e.g.:

> ## ⚠️ Flaky test annotation
> These tests failed on the first attempt and **passed on retry** — they should be stabilized:
> - `Payment flow — submit and confirm`
> - `Batch creation — validation errors`

This makes flakiness visible at review time instead of silently passing.

## 3. Fix

Flaky tests should be **stabilized**, not just retried:

1. **Read the trace** (`trace.zip` artifact, or `npx playwright show-trace`) from the failed attempt.
2. **Fix the root cause**:
   - Replace fixed sleeps with `expect(...).toBeVisible()` / `toBeEnabled()` auto-waiting
   - Use `page.waitForResponse` / `waitForRequest` for network-dependent steps
   - Make fixtures deterministic (reset DB, seeded data, isolated state)
3. **Verify** by running the test locally 3–5 times: `npx playwright test --repeat-each=5 <file>`
4. **Keep retries** as a safety net for the last 1% of real infra flakiness — but the goal is zero flaky tests.

## Definition of "done"

- [ ] Test passes reliably (no retry needed) in 3 consecutive CI runs
- [ ] Root cause fixed, not just retry count increased
- [ ] Trace/report no longer shows the test as flaky
