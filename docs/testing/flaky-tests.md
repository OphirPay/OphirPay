# Flaky E2E tests

## How retries work

CI runs each E2E test with **one automatic retry** (`retries: 1` in
`playwright.config.ts`, CI-only — local runs never retry). If a test fails
once and passes on retry, the PR isn't blocked — but it's not silent
either: `scripts/flaky-report.mjs` posts (or updates) a PR comment listing
every test that needed a retry.

## Mark

If you already know a test is unreliable, mark it explicitly instead of
letting it quietly eat a retry every run:

```ts
test('some flaky flow', async ({ page }) => {
  test.info().annotations.push({ type: "flaky", description: "issue #123" });
  // ...
});
```

Open a tracking issue and link it in the annotation.

## Report

- Every PR run automatically comments with any test that failed-then-passed
  on retry. Check that comment before merging — a test appearing across
  multiple PRs needs a real fix, not just a retry.
- If a test fails **both** attempts, CI fails as normal and uploads the
  Playwright HTML report (trace, screenshot, video) as a build artifact.

## Fix

1. Open an issue tagged `flaky-test`: which test, how often, any pattern
   (e.g. only on `firefox`, only under load).
2. Reproduce locally: `npm run test:e2e -- --repeat-each=5` (or `-g <name>`
   to target one test) to confirm before/after a fix.
3. Once stable, remove the `flaky` annotation from Mark.
4. If it can't be stabilized quickly, prefer `test.fixme()` over leaving it
   silently retried — a hidden retry hides a real problem.
