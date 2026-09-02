import { describe, it, expect } from "vitest";
import { parseFlakyTests, buildFlakyComment } from "./flaky-report.mjs";

function makeReport(tests: { title: string; results: { status: string }[] }[]) {
  return {
    suites: [
      {
        file: "example.spec.ts",
        specs: tests.map((t) => ({
          title: t.title,
          tests: [{ results: t.results }],
        })),
        suites: [],
      },
    ],
  };
}

describe("parseFlakyTests", () => {
  it("returns nothing when every test passed first try", () => {
    const report = makeReport([{ title: "loads homepage", results: [{ status: "passed" }] }]);
    expect(parseFlakyTests(report)).toEqual([]);
  });

  it("returns nothing for a test that failed and stayed failed", () => {
    const report = makeReport([
      { title: "loads homepage", results: [{ status: "failed" }, { status: "failed" }] },
    ]);
    expect(parseFlakyTests(report)).toEqual([]);
  });

  it("flags a test that failed once then passed on retry", () => {
    const report = makeReport([
      { title: "loads homepage", results: [{ status: "failed" }, { status: "passed" }] },
    ]);
    expect(parseFlakyTests(report)).toEqual([
      { title: "loads homepage", file: "example.spec.ts", attempts: 2 },
    ]);
  });

  it("walks nested suites", () => {
    const report = {
      suites: [
        {
          file: "nested.spec.ts",
          specs: [],
          suites: [
            {
              specs: [
                {
                  title: "nested test",
                  tests: [{ results: [{ status: "failed" }, { status: "passed" }] }],
                },
              ],
              suites: [],
            },
          ],
        },
      ],
    };
    expect(parseFlakyTests(report)).toEqual([
      { title: "nested test", file: "nested.spec.ts", attempts: 2 },
    ]);
  });
});

describe("buildFlakyComment", () => {
  it("returns null when there are no flaky tests", () => {
    expect(buildFlakyComment([])).toBeNull();
  });

  it("includes each flaky test in a table row", () => {
    const comment = buildFlakyComment([
      { title: "loads homepage", file: "example.spec.ts", attempts: 2 },
    ]);
    expect(comment).toContain("loads homepage");
    expect(comment).toContain("example.spec.ts");
    expect(comment).toContain("Flaky E2E tests detected");
  });
});
