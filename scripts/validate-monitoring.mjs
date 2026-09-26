#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// ─────────────────────────────────────────────────────────────────────────────
// OphirPay — Prometheus alert-rule check (issue #754)
// ─────────────────────────────────────────────────────────────────────────────
// Cross-checks `monitoring/prometheus-alerts.yml` against the metrics the app
// actually publishes at `/api/metrics`:
//
//   1. Parses the alert rules and extracts every metric selector used by an
//      alert expression (`expr`).
//   2. Extracts the metric names exposed by `src/app/api/metrics/route.ts`
//      (`# HELP` / `# TYPE` lines plus the emitted sample lines, including
//      histogram companions).
//   3. Fails, naming the alert and the metric, for every selector that the
//      route does not expose and that the alert does not declare as external
//      with an `# external: <metric>[, <metric>…]` comment placed inside the
//      alert block (see the convention documented in the rules file header and
//      `docs/metrics-endpoints.md`).
//
// The check is intentionally dependency-free (Node >= 18, two files read, no
// network, no install) so it can run as a fast standalone CI job next to
// `promtool check rules`.
//
// Usage:
//   node scripts/validate-monitoring.mjs
//   node scripts/validate-monitoring.mjs --rules <path> --metrics-route <path>
//
// Exit code: 0 when every referenced metric is accounted for, 1 otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const DEFAULT_RULES_PATH = path.join(ROOT, "monitoring", "prometheus-alerts.yml");
export const DEFAULT_METRICS_ROUTE_PATH = path.join(ROOT, "src", "app", "api", "metrics", "route.ts");

const USAGE = `Usage: node scripts/validate-monitoring.mjs [--rules <path>] [--metrics-route <path>]

Cross-checks the Prometheus alert rules against the metrics exposed by
src/app/api/metrics/route.ts. Every metric selector used by an alert expression
must either be exposed by the route or be declared inside the alert block with
an "# external: <metric>[, <metric>…]" comment (see docs/metrics-endpoints.md).`;

/** Prometheus metric/label name character set. */
const METRIC_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

/**
 * PromQL keywords that can show up outside of label selectors and must not be
 * mistaken for metric names. Aggregation operators are included because
 * `sum by (job) (...)` puts `sum` before a group clause instead of a call.
 */
const PROMQL_KEYWORDS = new Set([
  // aggregation operators
  "sum", "avg", "min", "max", "count", "group", "stddev", "stdvar",
  "topk", "bottomk", "quantile", "count_values", "limitk", "limit_ratio",
  // vector matching / modifiers
  "by", "without", "on", "ignoring", "group_left", "group_right",
  "offset", "bool", "and", "or", "unless",
]);

/** Keywords directly followed by a `(label, …)` group clause to skip. */
const LABEL_CLAUSE_KEYWORDS = new Set(["by", "without", "on", "ignoring", "group_left", "group_right"]);

const ALERT_ENTRY_RE = /^(\s*)- (alert|record):\s*(.*?)\s*$/;
const EXTERNAL_DECL_RE = /^\s*#\s*external:\s*(.*?)\s*$/;
const EXPR_KEY_RE = /^(\s*)expr:\s*(.*?)\s*$/;
const BLOCK_SCALAR_RE = /^[|>][+-]?\d*$/;

/**
 * Extract the metric names a PromQL expression references.
 *
 * Only vector selectors count: identifiers inside `{label="value"}` selectors
 * (including label values), function names (`rate(...)`), aggregation keywords
 * (`sum by ...`), matching keywords (`offset`, `bool`, `and`, …), group
 * clauses and durations (`[5m]`) are ignored. Names are returned in
 * first-appearance order, duplicated per expression at most once.
 */
export function extractPromqlMetricNames(expr) {
  const names = [];
  const seen = new Set();
  const text = typeof expr === "string" ? expr : "";

  let i = 0;
  let depth = 0;
  let quote = null;

  while (i < text.length) {
    const ch = text[i];

    if (quote) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) depth -= 1;
      i += 1;
      continue;
    }

    const previous = i > 0 ? text[i - 1] : "";
    const isWordStart =
      depth === 0 && /[a-zA-Z_:]/.test(ch) && !/[a-zA-Z0-9_:]/.test(previous);
    if (!isWordStart) {
      i += 1;
      continue;
    }

    let end = i;
    while (end < text.length && /[a-zA-Z0-9_:]/.test(text[end])) end += 1;
    const word = text.slice(i, end);
    i = end;

    if (PROMQL_KEYWORDS.has(word)) {
      if (LABEL_CLAUSE_KEYWORDS.has(word)) i = skipGroupClause(text, i);
      continue;
    }

    // Function calls (`rate(`, `histogram_quantile(`) are not metric names.
    let next = end;
    while (next < text.length && /\s/.test(text[next])) next += 1;
    if (text[next] === "(") continue;

    if (!seen.has(word)) {
      seen.add(word);
      names.push(word);
    }
  }

  return names;
}

/** Skip a `(label, …)` group clause starting at or after `start`. */
function skipGroupClause(expr, start) {
  let i = start;
  while (i < expr.length && expr[i] !== "(") i += 1;
  if (i >= expr.length) return expr.length;

  let depth = 0;
  let quote = null;
  for (; i < expr.length; i += 1) {
    const ch = expr[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return expr.length;
}

/** `# HELP name …` / `# TYPE name …` exposition lines (declared metrics). */
const HELP_TYPE_RE = /^[^\S\n]*["'`]?#\s+(?:HELP|TYPE)\s+([a-zA-Z_:][a-zA-Z0-9_:]*)/gm;

/** `# TYPE name <type>` lines, used to expand histogram companions. */
const TYPE_RE = /^[^\S\n]*["'`]?#\s+TYPE\s+([a-zA-Z_:][a-zA-Z0-9_:]*)\s+([a-zA-Z]+)/gm;

/** Emitted sample lines: `<name>{…}` or `<name> <value>` inside a literal. */
const SAMPLE_LINE_RE = /^[^\S\n]*[`'"]([a-zA-Z_:][a-zA-Z0-9_:]*)(?=[{\s])/gm;

/**
 * Extract the metric names exposed by the metrics route source.
 *
 * Two sources of truth are combined:
 *   - `# HELP <name>` / `# TYPE <name>` exposition lines, and
 *   - emitted sample lines that start with a metric name (`which is what
 *     surfaces the `_bucket`/`_sum`/`_count` companions that the route emits
 *     line by line).
 *
 * A histogram's TYPE line declares the family name; the scrapeable series are
 * its `_bucket`/`_sum`/`_count` companions, so those — not the bare family
 * name — count as exposed.
 */
export function extractExposedMetrics(source) {
  const text = typeof source === "string" ? source : "";
  const names = new Set();
  for (const match of text.matchAll(HELP_TYPE_RE)) names.add(match[1]);
  for (const match of text.matchAll(SAMPLE_LINE_RE)) names.add(match[1]);

  for (const match of text.matchAll(TYPE_RE)) {
    const [, name, type] = match;
    if (type === "histogram") {
      for (const suffix of ["_bucket", "_sum", "_count"]) names.add(`${name}${suffix}`);
    }
  }

  return names;
}

/**
 * Parse an `# external:` declaration body into a list of metric names.
 *
 * Format: `# external: metric_a, metric_b` — comma-separated Prometheus
 * metric names. Anything else is a malformed declaration and is reported as an
 * error so a typo in the declaration cannot silently disable the check.
 */
export function parseExternalDeclaration(body) {
  const metrics = [];
  const invalid = [];
  for (const part of String(body ?? "").split(",")) {
    const name = part.trim();
    if (name === "") continue;
    if (METRIC_NAME_RE.test(name)) metrics.push(name);
    else invalid.push(name);
  }
  if (invalid.length > 0) {
    return {
      metrics,
      error: `malformed "# external:" declaration — ${invalid
        .map((name) => `"${name}"`)
        .join(", ")} ${invalid.length === 1 ? "is" : "are"} not valid Prometheus metric name(s)`,
    };
  }
  return { metrics, error: null };
}

/**
 * Parse the alert rules source and collect, for every `alert:`/`record:`
 * entry, its expression and the external-metric declarations attached to it.
 *
 * A declaration belongs to the alert block it is written in: it must appear
 * between the entry's own `- alert:` line and the next entry. A declaration
 * anywhere else (file header, between two entries) is reported as an error
 * instead of being silently ignored.
 */
export function collectAlertRules(source) {
  const lines = String(source ?? "").split(/\r?\n/);
  const entries = [];
  const errors = [];
  let current = null;
  let pending = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    const entryMatch = line.match(ALERT_ENTRY_RE);
    if (entryMatch) {
      for (const declaration of pending) {
        errors.push(
          `line ${declaration.line}: "# external: ${declaration.metrics.join(", ")}" must live inside the alert block it applies to — put it directly under the "- ${entryMatch[2]}: …" line`
        );
      }
      pending = [];
      current = {
        kind: entryMatch[2],
        name: entryMatch[3] || "(unnamed)",
        line: lineNumber,
        external: new Set(),
        externalDeclarations: new Map(),
        expr: null,
        exprLine: null,
      };
      entries.push(current);
      continue;
    }

    const declMatch = line.match(EXTERNAL_DECL_RE);
    if (declMatch) {
      const { metrics, error } = parseExternalDeclaration(declMatch[1]);
      if (error) {
        errors.push(`line ${lineNumber}: ${error}`);
      }
      if (current) {
        for (const metric of metrics) {
          current.external.add(metric);
          current.externalDeclarations.set(metric, lineNumber);
        }
      } else if (metrics.length > 0) {
        pending.push({ line: lineNumber, metrics });
      }
      continue;
    }

    if (!current) continue;

    const exprMatch = line.match(EXPR_KEY_RE);
    if (!exprMatch) continue;

    const exprIndent = exprMatch[1].length;
    const rest = exprMatch[2];
    if (rest === "" || BLOCK_SCALAR_RE.test(rest)) {
      const blockLines = [];
      let scan = index + 1;
      for (; scan < lines.length; scan += 1) {
        const next = lines[scan];
        const trimmed = next.trim();
        if (trimmed === "") {
          blockLines.push("");
          continue;
        }
        const nextIndent = next.length - next.trimStart().length;
        if (nextIndent <= exprIndent) break;
        if (ALERT_ENTRY_RE.test(next)) break;
        blockLines.push(trimmed);
      }
      current.expr = blockLines.join("\n").trim();
      current.exprLine = lineNumber;
      index = scan - 1;
    } else {
      current.expr = rest;
      current.exprLine = lineNumber;
    }
  }

  for (const declaration of pending) {
    errors.push(
      `line ${declaration.line}: "# external: ${declaration.metrics.join(", ")}" must live inside the alert block it applies to — no alert follows it`
    );
  }

  return { entries, errors };
}

/** Single-line rendering of an expression for error messages. */
function describeExpr(expr) {
  return JSON.stringify(String(expr ?? "").replace(/\s+/g, " ").trim());
}

/**
 * Cross-check the alert rules against the metrics exposed by the app.
 *
 * Returns `{ ok, errors, warnings, stats }`. Errors name the alert and the
 * metric; warnings flag declarations that no longer match the expression
 * (stale) or that contradict the metrics route (declared external while the
 * route publishes the metric).
 */
export function validateAlertRules(rulesSource, metricsRouteSource) {
  const errors = [];
  const warnings = [];
  const { entries, errors: parseErrors } = collectAlertRules(rulesSource);

  errors.push(...parseErrors);

  const exposed = extractExposedMetrics(metricsRouteSource);
  const uniqueMetrics = new Set();
  const externalMetrics = new Set();
  let references = 0;

  for (const entry of entries) {
    const label = `${entry.kind} "${entry.name}"`;
    const refs = extractPromqlMetricNames(entry.expr ?? "");
    references += refs.length;

    for (const metric of refs) {
      uniqueMetrics.add(metric);
      if (entry.external.has(metric)) {
        externalMetrics.add(metric);
        if (exposed.has(metric)) {
          warnings.push(
            `${label} declares "${metric}" as external (line ${entry.externalDeclarations.get(metric)}) but src/app/api/metrics/route.ts exposes it — drop the "# external:" declaration`
          );
        }
      } else if (!exposed.has(metric)) {
        errors.push(
          `${label} references metric "${metric}", which src/app/api/metrics/route.ts does not expose (expr: ${describeExpr(entry.expr)}) — fix the selector or declare it with "# external: ${metric}" inside the alert block`
        );
      }
    }

    for (const metric of entry.external) {
      if (!refs.includes(metric)) {
        warnings.push(
          `${label} declares "${metric}" as external (line ${entry.externalDeclarations.get(metric)}) but its expression does not reference it — remove the stale declaration`
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      alerts: entries.length,
      references,
      uniqueMetrics: uniqueMetrics.size,
      externalMetrics: externalMetrics.size,
      exposedMetrics: [...uniqueMetrics].filter((metric) => exposed.has(metric)).length,
    },
  };
}

function parseArgs(argv) {
  const options = { rulesPath: DEFAULT_RULES_PATH, metricsRoutePath: DEFAULT_METRICS_ROUTE_PATH, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--rules") {
      options.rulesPath = argv[i + 1];
      i += 1;
    } else if (arg === "--metrics-route") {
      options.metricsRoutePath = argv[i + 1];
      i += 1;
    } else {
      return { error: `unknown argument "${arg}"` };
    }
  }
  if (argv.includes("--rules") && !options.rulesPath) return { error: "--rules requires a path" };
  if (argv.includes("--metrics-route") && !options.metricsRoutePath) {
    return { error: "--metrics-route requires a path" };
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) {
    console.error(options.error);
    console.error(USAGE);
    process.exit(1);
  }
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const rulesPath = path.resolve(options.rulesPath);
  const metricsRoutePath = path.resolve(options.metricsRoutePath);

  let rulesSource;
  let metricsRouteSource;
  try {
    rulesSource = fs.readFileSync(rulesPath, "utf8");
    metricsRouteSource = fs.readFileSync(metricsRoutePath, "utf8");
  } catch (error) {
    console.error(`❌ cannot read input file: ${error.message}`);
    process.exit(1);
  }

  const { ok, errors, warnings, stats } = validateAlertRules(rulesSource, metricsRouteSource);

  for (const warning of warnings) console.error(`⚠️  ${warning}`);

  if (!ok) {
    for (const error of errors) console.error(`❌ ${error}`);
    console.error(
      `❌ Alert-rule validation failed: ${errors.length} undeclared metric reference(s). Every selector must be published by src/app/api/metrics/route.ts or declared with an "# external:" comment inside its alert block.`
    );
    process.exit(1);
  }

  console.log(
    `✅ ${stats.alerts} alert rule(s) checked — ${stats.references} metric reference(s), ${stats.uniqueMetrics} unique metric(s): ` +
      `${stats.externalMetrics} declared external, ${stats.exposedMetrics} published by src/app/api/metrics/route.ts.`
  );
  if (warnings.length > 0) console.error(`⚠️  ${warnings.length} warning(s).`);
  process.exit(0);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
