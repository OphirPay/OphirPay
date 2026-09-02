// Parses a Playwright JSON report and finds tests that failed on their
// first attempt but passed after CI's automatic retry — i.e. flaky tests.
// When run in CI on a pull_request event, posts (or updates) a PR comment
// listing them. See docs/testing/flaky-tests.md for the full process.

import { readFileSync } from "node:fs";

export function parseFlakyTests(report) {
  const flaky = [];

  function walkSuite(suite, filePath) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        if (results.length > 1 && results[results.length - 1].status === "passed") {
          flaky.push({
            title: spec.title,
            file: filePath ?? suite.file ?? "unknown",
            attempts: results.length,
          });
        }
      }
    }
    for (const child of suite.suites ?? []) {
      walkSuite(child, filePath ?? suite.file);
    }
  }

  for (const suite of report.suites ?? []) {
    walkSuite(suite, suite.file);
  }

  return flaky;
}

export function buildFlakyComment(flakyTests) {
  if (flakyTests.length === 0) return null;

  const rows = flakyTests
    .map((t) => `| \`${t.file}\` | ${t.title} | ${t.attempts - 1} |`)
    .join("\n");

  return [
    "### ⚠️ Flaky E2E tests detected",
    "",
    "The following tests failed at least once but passed on retry in this run.",
    "They did **not** block the PR, but see [docs/testing/flaky-tests.md](../blob/main/docs/testing/flaky-tests.md) to mark, report, and fix them.",
    "",
    "| File | Test | Retries needed |",
    "|---|---|---|",
    rows,
  ].join("\n");
}

const FLAKY_COMMENT_MARKER = "<!-- flaky-e2e-report -->";

/** Resolves the PR comments API URL + auth headers, or null outside a PR context. */
function getPrCommentContext() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!token || !repo || !eventPath) return null;

  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const prNumber = event.pull_request?.number;
  if (!prNumber) return null;

  return {
    repo,
    api: `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
  };
}

/** Pages through all PR comments (GitHub returns them ~30 at a time) to find ours. */
async function findMarkerComment(api, headers) {
  let page = 1;
  for (;;) {
    const res = await fetch(`${api}?per_page=100&page=${page}`, { headers });
    const comments = await res.json();
    if (!Array.isArray(comments) || comments.length === 0) return null;

    const found = comments.find((c) => c.body?.includes(FLAKY_COMMENT_MARKER));
    if (found) return found;

    if (comments.length < 100) return null; // no more pages
    page += 1;
  }
}

async function postOrUpdateComment(body) {
  const ctx = getPrCommentContext();
  if (!ctx) {
    console.log("Not running in a PR context with GITHUB_TOKEN set — skipping comment.");
    return;
  }
  const { api, headers, repo } = ctx;

  const previous = await findMarkerComment(api, headers);
  const commentBody = `${FLAKY_COMMENT_MARKER}\n${body}`;

  if (previous) {
    await fetch(`https://api.github.com/repos/${repo}/issues/comments/${previous.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ body: commentBody }),
    });
  } else {
    await fetch(api, {
      method: "POST",
      headers,
      body: JSON.stringify({ body: commentBody }),
    });
  }
}

/** Clears a stale flaky-report comment left over from a previous, flakier run. */
async function clearStaleComment() {
  const ctx = getPrCommentContext();
  if (!ctx) return;
  const { api, headers, repo } = ctx;

  const previous = await findMarkerComment(api, headers);
  if (!previous) return; // nothing to clean up

  await fetch(`https://api.github.com/repos/${repo}/issues/comments/${previous.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      body: `${FLAKY_COMMENT_MARKER}\n### ✅ No flaky E2E tests in the latest run`,
    }),
  });
}

async function main() {
  const reportPath = process.argv[2] ?? "playwright-report/results.json";
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    console.log(`No Playwright JSON report at ${reportPath} — nothing to check.`);
    return;
  }

  const flaky = parseFlakyTests(report);
  const comment = buildFlakyComment(flaky);

  if (!comment) {
    console.log("No flaky tests this run.");
    await clearStaleComment();
    return;
  }

  console.log(comment);
  await postOrUpdateComment(comment);
}

if (process.argv[1] && process.argv[1].endsWith("flaky-report.mjs")) {
  main();
}