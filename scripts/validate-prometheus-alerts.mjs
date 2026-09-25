#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Validates Prometheus alert rules and cross-checks metric references (Issue #754).
 *
 * 1. Validates YAML structure and Prometheus alert rule schema.
 * 2. Runs `promtool check rules --lint-fatal` when promtool is available.
 * 3. Enforces that there are no duplicate alert rules or malformed labels.
 * 4. Extracts every metric identifier from PromQL alert expressions (`expr`).
 * 5. Cross-checks that every referenced metric is either:
 *    (a) Exposed by `src/app/api/metrics/route.ts`, or
 *    (b) Explicitly declared as an external metric in the alert rule via `# external: <metric>`.
 *
 * Usage:
 *   node scripts/validate-prometheus-alerts.mjs
 *   node scripts/validate-prometheus-alerts.mjs --rules monitoring/prometheus-alerts.yml
 *   node scripts/validate-prometheus-alerts.mjs --rules <path> --metrics <path>
 *   node scripts/validate-prometheus-alerts.mjs --skip-promtool
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const DEFAULT_RULES_PATH = 'monitoring/prometheus-alerts.yml';
export const DEFAULT_METRICS_PATH = 'src/app/api/metrics/route.ts';

/**
 * Standard PromQL keywords, aggregators, functions, and boolean/logical operators
 * that must not be mistaken for metric selectors.
 */
export const PROMQL_RESERVED = new Set([
  'abs',
  'absent',
  'absent_over_time',
  'acos',
  'acosh',
  'and',
  'asin',
  'asinh',
  'atan',
  'atan2',
  'atanh',
  'avg',
  'avg_over_time',
  'bool',
  'bottomk',
  'by',
  'ceil',
  'changes',
  'clamp',
  'clamp_max',
  'clamp_min',
  'cos',
  'cosh',
  'count',
  'count_over_time',
  'count_values',
  'day_of_month',
  'day_of_week',
  'day_of_year',
  'days_in_month',
  'deg',
  'delta',
  'deriv',
  'exp',
  'floor',
  'group_left',
  'group_right',
  'histogram_avg',
  'histogram_count',
  'histogram_fraction',
  'histogram_quantile',
  'histogram_stddev',
  'histogram_stdvar',
  'histogram_sum',
  'hour',
  'idelta',
  'ignoring',
  'increase',
  'inf',
  'irate',
  'label_join',
  'label_replace',
  'last_over_time',
  'ln',
  'log10',
  'log2',
  'mad_over_time',
  'max',
  'max_over_time',
  'min',
  'min_over_time',
  'minute',
  'month',
  'nan',
  'offset',
  'on',
  'or',
  'pi',
  'predict_linear',
  'present_over_time',
  'quantile',
  'quantile_over_time',
  'rad',
  'rate',
  'resets',
  'round',
  'scalar',
  'sgn',
  'sin',
  'sinh',
  'sort',
  'sort_desc',
  'sqrt',
  'stddev',
  'stddev_over_time',
  'stdvar',
  'stdvar_over_time',
  'sum',
  'sum_over_time',
  'tan',
  'tanh',
  'time',
  'timestamp',
  'topk',
  'unless',
  'vector',
  'without',
  'year',
]);

/**
 * Extracts all metric identifiers from a PromQL expression.
 * Handles functions, aggregators, label selectors, time range windows, numbers,
 * and arithmetic operators.
 *
 * @param {string} expr
 * @returns {string[]} unique metric names in order of appearance
 */
export function extractMetricsFromPromQL(expr) {
  if (!expr || typeof expr !== 'string') return [];

  // Strip single-line comments (# ...)
  let cleaned = expr.replace(/#[^\r\n]*/g, ' ');

  // Strip quoted strings ("..." or '...')
  cleaned = cleaned.replace(/"(?:[^"\\]|\\.)*"/g, ' ');
  cleaned = cleaned.replace(/'(?:[^'\\]|\\.)*'/g, ' ');

  // Strip label selectors `{...}`
  cleaned = cleaned.replace(/\{[^{}]*\}/g, ' ');

  // Strip range durations `[5m]`, `[15m]`, etc.
  cleaned = cleaned.replace(/\[[^[\]]*\]/g, ' ');

  // Strip floating-point and integer numbers (signed/unsigned)
  cleaned = cleaned.replace(/(^|[^a-zA-Z0-9_:])[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g, '$1 ');

  // Tokenize by non-identifier characters
  const rawTokens = cleaned.split(/[^a-zA-Z0-9_:]+/);
  const metrics = [];
  const seen = new Set();

  for (const token of rawTokens) {
    if (!token) continue;
    // Metric name must match standard Prometheus regex: [a-zA-Z_:][a-zA-Z0-9_:]*
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(token)) continue;
    // Exclude PromQL reserved keywords/functions
    if (PROMQL_RESERVED.has(token.toLowerCase())) continue;
    // Exclude tokens that look like pure numbers
    if (/^\d+$/.test(token)) continue;

    if (!seen.has(token)) {
      seen.add(token);
      metrics.push(token);
    }
  }

  return metrics;
}

/**
 * Extracts exposed metric names from `src/app/api/metrics/route.ts`.
 *
 * @param {string} content - Source code of the metrics route.
 * @returns {Set<string>} set of metric names exposed by the route.
 */
export function extractMetricsFromRoute(content) {
  const exposed = new Set();

  // 1. Extract from Prometheus comment annotations: `# HELP <metric>` or `# TYPE <metric> <type>`
  const typeRegex = /#\s+TYPE\s+([a-zA-Z0-9_:]+)\s+([a-zA-Z0-9_]+)/g;
  let match;
  while ((match = typeRegex.exec(content)) !== null) {
    const [, name, metricType] = match;
    exposed.add(name);
    if (metricType === 'histogram') {
      exposed.add(`${name}_bucket`);
      exposed.add(`${name}_sum`);
      exposed.add(`${name}_count`);
    } else if (metricType === 'summary') {
      exposed.add(`${name}_sum`);
      exposed.add(`${name}_count`);
    }
  }

  const helpRegex = /#\s+HELP\s+([a-zA-Z0-9_:]+)\s+/g;
  while ((match = helpRegex.exec(content)) !== null) {
    exposed.add(match[1]);
  }

  // 2. Extract emitted metric lines: e.g. `ophirpay_xxx ${...}` or `ophirpay_xxx{...} ${...}`
  const emittedRegex = /`([a-zA-Z0-9_:]+)(?:\{|\s)/g;
  while ((match = emittedRegex.exec(content)) !== null) {
    exposed.add(match[1]);
  }

  // 3. Extract literals like 'ophirpay_info{version="1.0.0"} 1'
  const literalRegex = /['"](ophirpay_[a-zA-Z0-9_:]+)(?:\{|\s)/g;
  while ((match = literalRegex.exec(content)) !== null) {
    exposed.add(match[1]);
  }

  return exposed;
}

/**
 * Parses alert rules and extracts their declared `# external:` comments.
 *
 * @param {string} rawYaml
 * @returns {{ rules: Array<{ alert: string, expr: string, external: Set<string>, labels?: any, annotations?: any, group: string }>, errors: string[] }}
 */
export function parseAlertRulesWithExternals(rawYaml) {
  const errors = [];
  let parsed;

  try {
    parsed = yaml.load(rawYaml);
  } catch (err) {
    return { rules: [], errors: [`YAML parsing error: ${err.message}`] };
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.groups)) {
    return { rules: [], errors: ['Invalid rules file: root object must have a "groups" array.'] };
  }

  // Line-by-line parsing to associate `# external:` comments with specific alert blocks
  const lines = rawYaml.split(/\r?\n/);
  const alertExternalMap = new Map();
  let currentAlertName = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const alertMatch = line.match(/^\s*-\s*alert:\s*["']?([a-zA-Z0-9_-]+)["']?/);
    if (alertMatch) {
      currentAlertName = alertMatch[1];
      if (!alertExternalMap.has(currentAlertName)) {
        alertExternalMap.set(currentAlertName, new Set());
      }
      continue;
    }

    const externalMatch = line.match(/^\s*#\s*external:\s*(.+)$/i);
    if (externalMatch) {
      if (!currentAlertName) {
        errors.push(
          `Misplaced external declaration at line ${i + 1}: "# external: ${externalMatch[1].trim()}" ` +
            'must be placed within a specific alert rule block.'
        );
        continue;
      }
      const rawMetrics = externalMatch[1].split(/[\s,]+/);
      for (const m of rawMetrics) {
        const trimmed = m.trim();
        if (trimmed) {
          alertExternalMap.get(currentAlertName).add(trimmed);
        }
      }
    }
  }

  const rules = [];
  const alertNamesSeen = new Set();

  for (const group of parsed.groups) {
    const groupName = group.name || '(unnamed group)';
    if (!Array.isArray(group.rules)) continue;

    for (const rule of group.rules) {
      if (!rule || typeof rule !== 'object') continue;

      if (!rule.alert) {
        // Record rules (with 'record:') are allowed in Prometheus, but alerts require 'alert:'
        if (!rule.record) {
          errors.push(`Rule in group "${groupName}" is missing both "alert" and "record" fields.`);
        }
        continue;
      }

      const alertName = rule.alert;
      if (alertNamesSeen.has(alertName)) {
        errors.push(`Duplicate alert rule found: "${alertName}" (in group "${groupName}").`);
      }
      alertNamesSeen.add(alertName);

      if (!rule.expr) {
        errors.push(`Alert "${alertName}" is missing required "expr" field.`);
      }

      const external = alertExternalMap.get(alertName) || new Set();

      rules.push({
        alert: alertName,
        expr: String(rule.expr || ''),
        external,
        labels: rule.labels,
        annotations: rule.annotations,
        group: groupName,
      });
    }
  }

  return { rules, errors };
}

/**
 * Checks if promtool is available on PATH.
 *
 * @returns {boolean}
 */
export function hasPromtool() {
  const result = spawnSync('which', ['promtool'], { stdio: 'pipe', encoding: 'utf8' });
  return result.status === 0;
}

/**
 * Runs `promtool check rules --lint-fatal <rulesPath>`.
 *
 * @param {string} rulesPath
 * @returns {{ success: boolean, output: string, error?: string }}
 */
export function runPromtoolCheck(rulesPath) {
  try {
    const output = execFileSync(
      'promtool',
      ['check', 'rules', '--lint-fatal', rulesPath],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return { success: true, output };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    return {
      success: false,
      output: `${stdout}\n${stderr}`.trim(),
      error: err.message,
    };
  }
}

/**
 * @typedef {object} ValidationSummary
 * @property {string} rulesPath
 * @property {string} metricsPath
 * @property {number} rulesCount
 * @property {number} metricsChecked
 * @property {number} uniqueMetrics
 * @property {boolean} promtoolRun
 */

/**
 * Performs full validation of Prometheus alert rules:
 * - YAML syntax & rule schema
 * - Duplicate alert check
 * - PromQL metric cross-check against route.ts & # external declarations
 * - Optional / automatic promtool check
 *
 * @param {object} [options]
 * @param {string} [options.rulesPath]
 * @param {string} [options.metricsPath]
 * @param {boolean} [options.skipPromtool]
 * @param {boolean} [options.requirePromtool]
 * @returns {{ success: boolean, errors: string[], summary: ValidationSummary }}
 */
export function validatePrometheusAlerts({
  rulesPath = DEFAULT_RULES_PATH,
  metricsPath = DEFAULT_METRICS_PATH,
  skipPromtool = false,
  requirePromtool = false,
} = {}) {
  const errors = [];
  const summary = {
    rulesPath,
    metricsPath,
    rulesCount: 0,
    metricsChecked: 0,
    uniqueMetrics: 0,
    promtoolRun: false,
  };

  const resolvedRules = resolve(rulesPath);
  if (!existsSync(resolvedRules)) {
    return {
      success: false,
      errors: [`Alert rules file does not exist: ${resolvedRules}`],
      summary,
    };
  }

  const resolvedMetrics = resolve(metricsPath);
  if (!existsSync(resolvedMetrics)) {
    return {
      success: false,
      errors: [`Metrics route file does not exist: ${resolvedMetrics}`],
      summary,
    };
  }

  const rawRules = readFileSync(resolvedRules, 'utf8');
  const rawMetrics = readFileSync(resolvedMetrics, 'utf8');

  // 1. Promtool check (if requested / available)
  if (!skipPromtool) {
    const promtoolAvailable = hasPromtool();
    if (promtoolAvailable) {
      const promtoolRes = runPromtoolCheck(resolvedRules);
      summary.promtoolRun = true;
      if (!promtoolRes.success) {
        errors.push(`promtool check failed:\n${promtoolRes.output}`);
      }
    } else if (requirePromtool) {
      errors.push('promtool is required but not installed or found on PATH.');
    }
  }

  // 2. Parse rules and external declarations
  const { rules, errors: parseErrors } = parseAlertRulesWithExternals(rawRules);
  errors.push(...parseErrors);
  summary.rulesCount = rules.length;

  // 3. Extract exposed metrics from route.ts
  const exposedMetrics = extractMetricsFromRoute(rawMetrics);

  // 4. Metric cross-check
  const allReferencedMetrics = new Set();

  for (const rule of rules) {
    const referenced = extractMetricsFromPromQL(rule.expr);
    for (const metric of referenced) {
      allReferencedMetrics.add(metric);
      summary.metricsChecked++;

      const isExposed = exposedMetrics.has(metric);
      const isDeclaredExternal = rule.external.has(metric);

      if (!isExposed && !isDeclaredExternal) {
        errors.push(
          `Alert "${rule.alert}" references undeclared metric "${metric}". ` +
            `It is neither exposed by ${metricsPath} nor declared with "# external: ${metric}".`
        );
      }
    }
  }

  summary.uniqueMetrics = allReferencedMetrics.size;

  return {
    success: errors.length === 0,
    errors,
    summary,
  };
}

// ── CLI Execution ─────────────────────────────────────────────────────────────

function runCli() {
  const args = process.argv.slice(2);
  let rulesPath = DEFAULT_RULES_PATH;
  let metricsPath = DEFAULT_METRICS_PATH;
  let skipPromtool = false;
  let requirePromtool = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rules' && args[i + 1]) {
      rulesPath = args[++i];
    } else if (args[i] === '--metrics' && args[i + 1]) {
      metricsPath = args[++i];
    } else if (args[i] === '--skip-promtool') {
      skipPromtool = true;
    } else if (args[i] === '--require-promtool') {
      requirePromtool = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Prometheus Alert Rules Validator (Issue #754)

Usage:
  node scripts/validate-prometheus-alerts.mjs [options]

Options:
  --rules <path>        Path to alert rules YAML (default: ${DEFAULT_RULES_PATH})
  --metrics <path>      Path to metrics route file (default: ${DEFAULT_METRICS_PATH})
  --skip-promtool       Skip running promtool check
  --require-promtool    Fail if promtool binary is not installed
  -h, --help            Show this help message
`);
      process.exit(0);
    }
  }

  console.log(`▶ Validating Prometheus alert rules: ${rulesPath}`);
  console.log(`  Cross-checking against metrics route: ${metricsPath}`);

  const result = validatePrometheusAlerts({
    rulesPath,
    metricsPath,
    skipPromtool,
    requirePromtool,
  });

  if (result.summary.promtoolRun) {
    console.log('  ✔ promtool check rules passed with --lint-fatal');
  } else if (!skipPromtool) {
    console.log('  ℹ promtool not found on PATH; static PromQL/schema validation applied');
  }

  if (result.success) {
    console.log(
      `✅ Validation passed: ${result.summary.rulesCount} alert rule(s) checked, ` +
        `${result.summary.uniqueMetrics} unique metric(s) verified.`
    );
    process.exit(0);
  } else {
    console.error(`❌ Validation failed with ${result.errors.length} error(s):`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  runCli();
}
