#!/usr/bin/env node
/**
 * scripts/validate-grafana-dashboard.mjs
 *
 * Grafana dashboard artifact check (issue #755).
 *
 * Validates `monitoring/grafana-dashboard.json` — the dashboard operators are
 * expected to import into Grafana:
 *
 *   1. The file is valid JSON and its top-level structure matches the schema
 *      the targeted Grafana version writes (title, uid, schemaVersion,
 *      panels, time, templating — see `monitoring/README.md`).
 *   2. Every metric queried by a panel target expression
 *      (`panels[].targets[].expr`) is actually exposed by the Prometheus
 *      endpoint implemented in `src/app/api/metrics/route.ts`. A panel that
 *      references a metric the app does not publish fails with the panel
 *      title and the metric named.
 *
 * The check is intentionally dependency-free (Node >= 18, two files read, no
 * network, no install) so it can run as a fast standalone CI job on every
 * change to the dashboard, the metrics route, or this script.
 *
 * Usage:
 *   node scripts/validate-grafana-dashboard.mjs
 *   node scripts/validate-grafana-dashboard.mjs --dashboard <path> --metrics-route <path>
 *
 * Exit code: 0 when the dashboard is valid and its queries are in sync,
 * 1 on any validation error.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const DEFAULT_DASHBOARD_PATH = path.join(ROOT, "monitoring", "grafana-dashboard.json");
export const DEFAULT_METRICS_ROUTE_PATH = path.join(ROOT, "src", "app", "api", "metrics", "route.ts");

/**
 * Dashboard JSON `schemaVersion` this repo pins the dashboard to.
 *
 * `schemaVersion: 39` is the format written by Grafana 10.3 through 11.2
 * (the 11.x line). Grafana 11.3+ writes 40 and Grafana 12 writes 41; newer
 * releases migrate older dashboards forward on import, so this dashboard
 * keeps importing — but a re-export from a newer Grafana must be a
 * deliberate upgrade: bump this constant and `monitoring/README.md`.
 */
export const SUPPORTED_SCHEMA_VERSION = 39;
export const SUPPORTED_GRAFANA_VERSION = "Grafana 11.x";

const USAGE =
  "Usage: node scripts/validate-grafana-dashboard.mjs [--dashboard <path>] [--metrics-route <path>]";

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

/**
 * Extract the metric names a PromQL expression references.
 *
 * Only vector selectors count: identifiers inside `{label="value"}` selectors,
 * function names (`rate(...)`), aggregation keywords (`sum by ...`), matching
 * keywords (`offset`, `bool`, `and`, …) and durations (`[5m]`) are ignored.
 */
export function extractPromqlMetricNames(expr) {
  const names = [];
  let i = 0;
  let depth = 0;
  let quote = null;

  while (i < expr.length) {
    const ch = expr[i];

    if (quote) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
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

    const previous = i > 0 ? expr[i - 1] : "";
    const isWordStart =
      depth === 0 && /[a-zA-Z_:]/.test(ch) && !/[a-zA-Z0-9_:]/.test(previous);
    if (!isWordStart) {
      i += 1;
      continue;
    }

    let end = i;
    while (end < expr.length && /[a-zA-Z0-9_:]/.test(expr[end])) end += 1;
    const word = expr.slice(i, end);
    i = end;

    if (PROMQL_KEYWORDS.has(word)) {
      if (LABEL_CLAUSE_KEYWORDS.has(word)) i = skipGroupClause(expr, i);
      continue;
    }

    // Function calls (`rate(`, `sum(`) are not metric names.
    let next = end;
    while (next < expr.length && /\s/.test(expr[next])) next += 1;
    if (expr[next] === "(") continue;

    names.push(word);
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

/** Emitted sample lines: `<name>{…} <value>` or `<name> <value>` in a literal. */
const SAMPLE_LINE_RE = /^[^\S\n]*[`'"]([a-zA-Z_:][a-zA-Z0-9_:]*)(?=[{\s])/gm;

/**
 * Extract the metric names exposed by the metrics route source.
 *
 * Two sources of truth are combined:
 *   - `# HELP <name>` / `# TYPE <name>` exposition lines, and
 *   - emitted sample lines that start with a metric name (which is what
 *     surfaces histogram `_bucket`/`_sum`/`_count` companions and summary
 *     `_count` samples that only exist as emitted lines).
 */
export function extractExposedMetrics(source) {
  const names = new Set();
  for (const match of source.matchAll(HELP_TYPE_RE)) names.add(match[1]);
  for (const match of source.matchAll(SAMPLE_LINE_RE)) names.add(match[1]);
  return names;
}

/** Human-readable label for a panel in error messages. */
function panelLabel(panel, index) {
  const id = Number.isInteger(panel?.id) ? ` (id ${panel.id})` : "";
  if (panel && typeof panel.title === "string" && panel.title.trim() !== "") {
    return `panel "${panel.title}"${id}`;
  }
  return `panel #${index + 1}${id}`;
}

/** Yield every `{ panel, index, target, targetIndex }` a dashboard defines. */
function* dashboardTargets(dashboard) {
  const panels = Array.isArray(dashboard?.panels) ? dashboard.panels : [];
  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index];
    if (!panel || typeof panel !== "object" || !Array.isArray(panel.targets)) continue;
    for (let targetIndex = 0; targetIndex < panel.targets.length; targetIndex += 1) {
      yield { panel, index, target: panel.targets[targetIndex], targetIndex };
    }
  }
}

/**
 * Collect every metric reference a dashboard makes:
 * `{ panel, metric, expr }` for each metric name found in each target expr.
 */
export function collectDashboardMetricReferences(dashboard) {
  const references = [];
  for (const { panel, index, target } of dashboardTargets(dashboard)) {
    if (typeof target?.expr !== "string" || target.expr.trim() === "") continue;
    const label = panelLabel(panel, index);
    for (const metric of extractPromqlMetricNames(target.expr)) {
      references.push({ panel: label, metric, expr: target.expr });
    }
  }
  return references;
}

/**
 * Validate the dashboards's required top-level fields for the targeted
 * Grafana schema. Returns a list of human-readable errors ([] = valid).
 */
export function validateDashboardShape(dashboard) {
  const errors = [];

  if (dashboard === null || typeof dashboard !== "object" || Array.isArray(dashboard)) {
    errors.push("dashboard must be a JSON object");
    return errors;
  }

  for (const field of ["title", "uid"]) {
    const value = dashboard[field];
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`missing required top-level field "${field}" (non-empty string)`);
    }
  }

  const { schemaVersion } = dashboard;
  if (!Number.isInteger(schemaVersion)) {
    errors.push('missing required top-level field "schemaVersion" (integer)');
  } else if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion ${schemaVersion} does not match the supported dashboard schema ` +
        `${SUPPORTED_SCHEMA_VERSION} (${SUPPORTED_GRAFANA_VERSION}); re-exported from a newer Grafana? ` +
        "Update SUPPORTED_SCHEMA_VERSION in scripts/validate-grafana-dashboard.mjs and monitoring/README.md."
    );
  }

  if (!Array.isArray(dashboard.panels) || dashboard.panels.length === 0) {
    errors.push('missing required top-level field "panels" (non-empty array)');
  } else {
    dashboard.panels.forEach((panel, index) => {
      if (panel === null || typeof panel !== "object" || Array.isArray(panel)) {
        errors.push(`panel #${index + 1} must be an object`);
        return;
      }
      const label = panelLabel(panel, index);
      if (typeof panel.title !== "string" || panel.title.trim() === "") {
        errors.push(`${label} is missing a non-empty "title"`);
      }
      if (!Array.isArray(panel.targets) || panel.targets.length === 0) {
        errors.push(`${label} has no "targets" array`);
        return;
      }
      panel.targets.forEach((target, targetIndex) => {
        if (
          target === null ||
          typeof target !== "object" ||
          typeof target.expr !== "string" ||
          target.expr.trim() === ""
        ) {
          errors.push(`${label} target #${targetIndex + 1} has no non-empty "expr"`);
        }
      });
    });
  }

  const time = dashboard.time;
  if (time === null || typeof time !== "object" || typeof time.from !== "string" || typeof time.to !== "string") {
    errors.push('missing required top-level field "time" (object with "from"/"to")');
  }

  const templating = dashboard.templating;
  if (templating === null || typeof templating !== "object" || !Array.isArray(templating.list)) {
    errors.push('missing required top-level field "templating" (object with "list" array)');
  }

  return errors;
}

/**
 * Run every check against raw file contents.
 *
 * Returns `{ ok, errors, warnings, stats }` — `ok` is true only when there
 * are no errors. Structure errors short-circuit the metric sync: the panels
 * cannot be trusted until the shape is fixed.
 */
export function runValidation(dashboardSource, metricsRouteSource) {
  const result = {
    ok: false,
    errors: [],
    warnings: [],
    stats: { panels: 0, references: 0, uniqueMetrics: 0, exposedMetrics: 0 },
  };

  let dashboard;
  try {
    dashboard = JSON.parse(dashboardSource);
  } catch (error) {
    result.errors.push(`dashboard JSON is malformed: ${error.message}`);
    return result;
  }

  const shapeErrors = validateDashboardShape(dashboard);
  result.errors.push(...shapeErrors);
  if (shapeErrors.length > 0) return result;

  const exposed = extractExposedMetrics(metricsRouteSource);
  result.stats.exposedMetrics = exposed.size;
  if (exposed.size === 0) {
    result.errors.push(
      "no metric names could be extracted from the metrics route source " +
        "(src/app/api/metrics/route.ts) — is it still a Prometheus exposition route?"
    );
    return result;
  }

  const references = collectDashboardMetricReferences(dashboard);
  result.stats.panels = dashboard.panels.length;
  result.stats.references = references.length;
  result.stats.uniqueMetrics = new Set(references.map((reference) => reference.metric)).size;

  const seen = new Set();
  for (const reference of references) {
    if (exposed.has(reference.metric)) continue;
    const message =
      `${reference.panel} queries "${reference.metric}", which src/app/api/metrics/route.ts ` +
      `does not expose (expr: ${JSON.stringify(reference.expr)})`;
    if (!seen.has(message)) {
      seen.add(message);
      result.errors.push(message);
    }
  }

  for (const { panel, index, target, targetIndex } of dashboardTargets(dashboard)) {
    if (typeof target?.expr !== "string" || target.expr.trim() === "") continue;
    if (extractPromqlMetricNames(target.expr).length === 0) {
      result.warnings.push(
        `${panelLabel(panel, index)} target #${targetIndex + 1} references no metric: ` +
          JSON.stringify(target.expr)
      );
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

function parseArgs(argv) {
  const options = { dashboard: DEFAULT_DASHBOARD_PATH, metricsRoute: DEFAULT_METRICS_ROUTE_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--dashboard" || arg === "--metrics-route") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        console.error(`❌ Missing value for ${arg}\n${USAGE}`);
        process.exit(1);
      }
      if (arg === "--dashboard") options.dashboard = value;
      else options.metricsRoute = value;
      i += 1;
    } else {
      console.error(`❌ Unknown argument: ${arg}\n${USAGE}`);
      process.exit(1);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  const readOrExit = (filePath, label) => {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch (error) {
      console.error(`❌ Could not read ${label}: ${filePath} (${error.message})`);
      process.exit(1);
    }
  };

  const dashboardSource = readOrExit(options.dashboard, "dashboard JSON");
  const metricsRouteSource = readOrExit(options.metricsRoute, "metrics route");

  console.log(`🔍 Validating Grafana dashboard: ${options.dashboard}`);
  const result = runValidation(dashboardSource, metricsRouteSource);

  for (const warning of result.warnings) {
    console.warn(`⚠️  ${warning}`);
  }

  if (result.ok) {
    const { panels, references, uniqueMetrics, exposedMetrics } = result.stats;
    console.log(
      `✅ Dashboard structure is valid (schemaVersion ${SUPPORTED_SCHEMA_VERSION}, ${SUPPORTED_GRAFANA_VERSION}).`
    );
    console.log(
      `✅ All ${references} metric reference(s) across ${panels} panel(s) are exposed by ` +
        `src/app/api/metrics/route.ts (${uniqueMetrics} unique queried / ${exposedMetrics} exposed).`
    );
    process.exit(0);
  }

  console.error(`❌ Dashboard validation failed with ${result.errors.length} error(s):`);
  for (const error of result.errors) {
    console.error(`   - ${error}`);
  }
  console.error(
    "\n💡 Keep the dashboard queries in sync with src/app/api/metrics/route.ts, then re-run:\n" +
      "   node scripts/validate-grafana-dashboard.mjs"
  );
  process.exit(1);
}

// Allow the module to be imported by tests without running main().
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
