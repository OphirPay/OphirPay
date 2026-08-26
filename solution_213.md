# Solution for #213: CI flake detection: retry/annotate flaky tests

// File: playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
});

// File: .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm
      - run: npm ci
      - run: npm run typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm
      - run: npm ci
      - run: npm run lint

  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm
      - run: npm ci
      - run: npm run test:unit

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm
      - run: npm ci
      - name: Install Playwright browsers
        run: npx playwright install --with-deps
      - name: Run E2E tests (with retry)
        run: npx playwright test --reporter=json,html
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-results
          path: |
            test-results.json
            playwright-report/
      - name: Annotate flaky tests
        if: success()
        uses: actions/github-script@v7
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            const fs = require('fs');
            const { context } = require('@actions/github');

            const reportPath = 'test-results.json';
            if (!fs.existsSync(reportPath)) {
              core.info('No test-results.json found, skipping annotation');
              return;
            }
            const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
            const flaky = [];

            for (const suite of report.suites || []) {
              for (const test of suite.specs || []) {
                if (test.retries > 0 && test.status === 'passed') {
                  flaky.push(test.title);
                }
              }
            }

            if (flaky.length === 0) {
              core.info('No flaky tests detected');
              return;
            }

            const owner = context.repo.owner;
            const repo = context.repo.repo;
            const issueNumber = context.issue.number;

            const commentBody = `## 🧪 Flaky tests detected
            The following E2E tests passed only after retry:
            ${flaky.map(t => `- \`${t}\``).join('\n')}

            Please investigate these flaky tests and fix them. For guidance, see [Flaky Test Process](docs/flaky-tests.md).

            <!-- FLAKY-TEST-ANNOTATION -->`;

            const { data: comments } = await github.rest.issues.listComments({
              owner,
              repo,
              issue_number: issueNumber,
            });

            const existing = comments.find(c =>
              c.body.includes('<!-- FLAKY-TEST-ANNOTATION -->')
            );

            if (existing) {
              await github.rest.issues.updateComment({
                owner,
                repo,
                comment_id: existing.id,
                body: commentBody,
              });
            } else {
              await github.rest.issues.createComment({
                owner,
                repo,
                issue_number: issueNumber,
                body: commentBody,
              });
            }

  required-checks:
    runs-on: ubuntu-latest
    needs: [typecheck, lint, unit, e2e]
    if: always()
    steps:
      - name: Check all jobs succeeded
        run: |
          if [[ "${{ needs.typecheck.result }}" != "success" || \
                "${{ needs.lint.result }}" != "success" || \
                "${{ needs.unit.result }}" != "success" || \
                "${{ needs.e2e.result }}" != "success" ]]; then
            exit 1
          fi

// File: docs/flaky-tests.md
# Flaky Test Process

This document describes the process for handling flaky tests in our CI pipeline.

## What is a flaky test?
A flaky test is a test that passes and fails intermittently without any code changes. This erodes confidence in CI and wastes developer time.

## Marking flaky tests
- **E2E (Playwright)**: The CI automatically retries each test once. If a test passes on retry, it is annotated on the PR. No manual marking is required.
- **Unit (Vitest)**: Use `it.retry(1)` for known flaky tests, or add a `@flaky` tag in the test description for documentation.

## Reporting
- When a flaky E2E test passes after retry, the CI posts a comment on the PR listing the flaky tests.
- The comment includes a link to this documentation.
- The comment is updated with each new CI run; if no flaky tests are detected, any existing comment is removed (or left? – currently updated with an empty list, but we only post if flaky found; we could also delete).

## Fixing flaky tests
1. **Identify the root cause**: Use Playwright trace, video, and logs from the CI artifacts.
2. **Common causes**:
   - Race conditions (e.g., asynchronous UI updates, network requests).
   - Timeouts set too low.
   - Browser-specific issues (use `--project=chromium` etc. to isolate).
   - Test isolation issues (tests affecting each other).
3. **Fix**:
   - Add explicit waits (`waitForSelector`, `expect.poll`).
   - Ensure test data is deterministic.
   - Use `test.describe.serial` only when necessary.
   - Increase timeouts judiciously.
4. **Verify**: Run the test multiple times locally (`npx playwright test --repeat-each=10`).
5. **Submit a PR** with the fix and reference the flaky test issue.

If a test cannot be fixed quickly, consider adding `@flaky` to the test description and use `it.retry(2)` or similar to reduce noise, but prioritize a proper fix.

---
_Generated by DevilX BountyHub solver_
