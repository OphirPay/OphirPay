# Solution for #213: CI flake detection: retry/annotate flaky tests

=== BEGIN FILE: .github/workflows/ci.yml ===
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

permissions:
  contents: read
  pull-requests: write

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Unit & component tests (Vitest)
        run: npm run test:unit

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Run E2E tests with retry
        id: e2e
        continue-on-error: true
        run: |
          npx playwright test --reporter=json,html --output=test-results
        env:
          CI: true

      - name: Annotate flaky tests on PR
        if: github.event_name == 'pull_request' && (steps.e2e.outcome == 'failure' || steps.e2e.outcome == 'success')
        uses: actions/github-script@v7
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            const fs = require('fs');
            const path = require('path');
            const { execSync } = require('child_process');

            // Path to Playwright JSON report
            const reportPath = path.join(process.cwd(), 'test-results', 'results.json');
            if (!fs.existsSync(reportPath)) {
              console.log('No JSON report found, skipping annotation.');
              return;
            }

            const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
            const flakyTests = [];

            // Playwright report structure: suites -> tests -> results
            for (const suite of report.suites || []) {
              for (const test of suite.tests || []) {
                // Check if test had a retry that passed
                const results = test.results || [];
                if (results.length > 1) {
                  // Last result is the final outcome
                  const finalResult = results[results.length - 1];
                  const previousResults = results.slice(0, -1);
                  const hadFailureBefore = previousResults.some(r => r.status === 'failed' || r.status === 'timedOut');
                  if (hadFailureBefore && (finalResult.status === 'passed')) {
                    flakyTests.push({
                      title: test.title,
                      path: test.path,
                      retries: previousResults.length,
                    });
                  }
                }
              }
            }

            if (flakyTests.length === 0) {
              console.log('No flaky tests detected (all passed on first try or retry failed).');
              return;
            }

            // Build comment body
            let comment = '### 🧪 Flaky Test Detected (retry passed)\n\n';
            comment += 'The following E2E tests failed on the first attempt but passed after an automatic retry. They are considered flaky:\n\n';
            for (const t of flakyTests) {
              comment += `- \`${t.title}\` (${t.path}) – retried ${t.retries} time(s)\n`;
            }
            comment += '\nPlease review these tests and address flakiness. See [Flaky Test Process](docs/flaky-tests.md) for guidance.\n';

            // Post comment
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const botComment = comments.find(c => c.user.type === 'Bot' && c.body.includes('Flaky Test Detected'));
            if (botComment) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: botComment.id,
                body: comment,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body: comment,
              });
            }

      - name: Fail if E2E tests failed (after retries)
        if: steps.e2e.outcome == 'failure'
        run: exit 1

      - name: Upload test results (artifacts)
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: test-results/
=== END FILE: .github/workflows/ci.yml ===

=== BEGIN FILE: playwright.config.ts ===
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
=== END FILE: playwright.config.ts ===

=== BEGIN FILE: docs/flaky-tests.md ===
# Flaky Test Process

This document outlines how to handle flaky tests in our CI pipeline.

## Detection
- Every E2E test is automatically retried once on CI.
- If a test fails on the first attempt but passes on retry, the CI pipeline will post a comment on the PR listing it as a flaky test.

## Marking a test as flaky (known issue)
When you are unable to fix a flaky test immediately, you can explicitly mark it as flaky to avoid noise. Use Playwright's `test.fixme()` or `test.skip()` with a condition, but prefer `test.fixme()` to indicate it should be fixed later.

Example:
```typescript
test.fixme('flaky feature', async ({ page }) => {
  // test body
});
```

Alternatively, you can use the `test.fail()` method if the test is expected to fail intermittently, but this should be temporary.

## Reporting flaky tests
When the bot comments about a flaky test, take the following actions:
1. **Investigate** – Look at the test run logs (artifacts) to understand why it might be flaky.
   - Check for race conditions, asynchronous timing issues, or network dependencies.
   - Ensure proper use of `await` and page waits (`waitForSelector`, `waitForURL`, etc.).
2. **Reproduce locally** – Use `npx playwright test --repeat-each=10` to stress the test and identify patterns.
3. **Fix** – Adjust the test or the application code to make it deterministic.
   - If the flakiness is due to a known bug, create a separate issue and link it.
   - If the test is inherently fragile, consider rewriting it or splitting it into smaller, focused tests.

## Fixing flaky tests
- **Stable selectors** – Use `data-testid` attributes instead of CSS classes or text content that may change.
- **Network waits** – Use `page.waitForResponse` to ensure API calls complete.
- **Timeouts** – Increase timeouts for slow operations, but avoid excessive waiting.
- **Isolation** – Ensure each test is fully isolated (clean state, fresh DB, etc.).
- **Parallelism** – Run tests sequentially if needed, but prefer parallelism with proper isolation.

## CI integration
- The CI workflow automatically retries failed E2E tests once.
- If a test passes on retry, the PR is annotated, but the overall build still passes (since retry succeeded).
- If a test fails both attempts, the build fails and the PR cannot be merged until fixed.

## Review and monitoring
- Periodically review the list of flaky tests from PR comments and team reports.
- Use the Playwright HTML report (uploaded as artifact) to analyze failure patterns.
- Consider using a dedicated flaky test tracking tool if the volume becomes high.

## Ownership
- The author of the PR that introduces a flaky test is responsible for fixing it before merge.
- If a flaky test is already in `main`, the team should assign someone to address it in a follow-up PR.

## Tools
- Playwright's built-in retries and reporters.
- GitHub Actions for automation and annotations.
- `test-results` artifacts for debugging.

---

*Last updated: 2026-08-27*
=== END FILE: docs/flaky-tests.md ===

=== BEGIN FILE: .github/scripts/annotate-flaky.js ===
// This script is a standalone fallback in case the GitHub Script action is not suitable.
// It is not used in the current workflow; the annotation is done inline via actions/github-script.
// Kept for reference and potential future extension.
console.log('annotate-flaky.js is not used directly; see .github/workflows/ci.yml');
=== END FILE: .github/scripts/annotate-flaky.js ===

---
_Generated by DevilX BountyHub solver_
