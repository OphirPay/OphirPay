// SPDX-License-Identifier: MIT
//
// Content tests for the observability guide (issue #783). They keep
// docs/OBSERVABILITY.md honest against the artifacts it documents: every alert
// in monitoring/prometheus-alerts.yml needs a runbook entry (meaning, first
// actions, pause, escalation), and the "emitted today" claims must match what
// src/app/api/metrics/route.ts actually exposes.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (...p: string[]) => readFileSync(path.join(root, ...p), "utf8");

const doc = read("docs", "OBSERVABILITY.md");
const alertsYaml = read("monitoring", "prometheus-alerts.yml");
const metricsRoute = read("src", "app", "api", "metrics", "route.ts");

interface AlertRule {
  name: string;
  expr: string;
}

/** Split the rules file into `- alert:` blocks and capture each `expr`. */
function parseAlerts(yaml: string): AlertRule[] {
  return yaml
    .split(/^\s*- alert: /m)
    .slice(1)
    .map((block) => {
      const name = block.split("\n", 1)[0]!.trim();
      const expr = /expr:\s*\|?\s*\n?([\s\S]*?)\n\s*for:/.exec(block)?.[1] ?? "";
      return { name, expr };
    });
}

/** The text of the `#### <name>` runbook section, up to the next heading. */
function runbookSection(name: string): string | null {
  const start = doc.indexOf(`#### ${name}\n`);
  if (start === -1) return null;
  const rest = doc.slice(start + 1);
  const next = rest.search(/\n#{1,4} /);
  return next === -1 ? rest : rest.slice(0, next);
}

const alerts = parseAlerts(alertsYaml);

/** `ophirpay_*` series names referenced by an expression. */
function seriesIn(expr: string): string[] {
  return [...new Set(expr.match(/\bophirpay_[a-z0-9_]+/g) ?? [])];
}

/** Whether the endpoint exposes `series` (histogram `_bucket` etc. resolve to the family). */
function isEmitted(series: string): boolean {
  const family = series.replace(/_(bucket|sum|count)$/, "");
  return (
    metricsRoute.includes(`# TYPE ${series} `) ||
    metricsRoute.includes(`# TYPE ${family} histogram`)
  );
}

describe("docs/OBSERVABILITY.md", () => {
  it("parses every alert from the rules file", () => {
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) expect(a.expr.trim()).not.toBe("");
  });

  it.each(alerts.map((a) => a.name))("has a runbook entry for %s", (name) => {
    const section = runbookSection(name);
    expect(section, `missing "#### ${name}" heading`).not.toBeNull();
    expect(section).toMatch(/\*\*Meaning:\*\*/);
    expect(section).toMatch(/\*\*First actions:\*\*/);
    expect(section).toMatch(/\*\*Pause:\*\*/);
    expect(section).toMatch(/\*\*Escalate:\*\*/);
  });

  it("does not keep runbook entries for alerts that no longer exist", () => {
    const documented = [...doc.matchAll(/^#### ([A-Z][A-Za-z]+)$/gm)].map((m) => m[1]);
    const known = new Set(alerts.map((a) => a.name));
    expect(documented.filter((n) => !known.has(n!))).toEqual([]);
  });

  it("links every alert from the summary table", () => {
    for (const { name } of alerts) {
      expect(doc).toContain(`[\`${name}\`](#${name.toLowerCase()})`);
    }
  });

  it("marks each alert's 'Emitted today' status consistently with the metrics route", () => {
    for (const { name, expr } of alerts) {
      // `up` is synthesized by Prometheus itself, so it needs no exporter.
      const emitted = seriesIn(expr).every(isEmitted);
      const row = doc.split("\n").find((l) => l.startsWith(`| [\`${name}\``));
      expect(row, `no summary row for ${name}`).toBeDefined();
      expect(row!.trimEnd().endsWith(emitted ? "| Yes |" : "| No |"), `${name}: ${row}`).toBe(true);
    }
  });

  it("lists exactly the alert series the endpoint does not emit", () => {
    const missing = [
      ...new Set(alerts.flatMap((a) => seriesIn(a.expr)).filter((s) => !isEmitted(s))),
    ].sort();
    const section = doc.slice(doc.indexOf("### Alerts reference metrics that are not emitted"));
    const listed = [...section.matchAll(/`(ophirpay_[a-z0-9_]+)`/g)].map((m) => m[1]!);
    for (const series of missing) expect(listed).toContain(series);
  });

  it("documents the scrape credential, dashboard version and public-endpoint limitation", () => {
    expect(doc).toMatch(/Authorization: Bearer <METRICS_TOKEN>/);
    expect(doc).toMatch(/metrics_path: \/api\/metrics/);
    expect(doc).toMatch(/Grafana 10\.x/);
    expect(doc).toMatch(/schema version \*\*39\*\*/);
    expect(doc).toMatch(/UID\s+`prometheus`/);
    expect(doc).toMatch(/## Known limitations/);
    expect(doc).toMatch(/public metrics endpoint/i);
    expect(doc).toMatch(/emergency_pause_all/);
  });

  it("matches the dashboard artifact's schema version and uid", () => {
    const dash = JSON.parse(read("monitoring", "grafana-dashboard.json")) as {
      schemaVersion: number;
      uid: string;
    };
    expect(doc).toContain(`schema version **${dash.schemaVersion}**`);
    expect(doc).toContain(`keep the UID \`${dash.uid}\``);
  });

  it("is linked from monitoring/README.md and docs/metrics-endpoints.md", () => {
    expect(read("monitoring", "README.md")).toContain("../docs/OBSERVABILITY.md");
    expect(read("docs", "metrics-endpoints.md")).toContain("OBSERVABILITY.md");
  });
});
