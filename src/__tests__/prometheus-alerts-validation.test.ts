// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  extractMetricsFromPromQL,
  extractMetricsFromRoute,
  parseAlertRulesWithExternals,
  validatePrometheusAlerts,
  hasPromtool,
  runPromtoolCheck,
  DEFAULT_RULES_PATH,
  DEFAULT_METRICS_PATH,
} from '../../scripts/validate-prometheus-alerts.mjs';

describe('Prometheus Alert Rules & Metrics Validation (Issue #754)', () => {
  const root = process.cwd();
  const repoRulesPath = resolve(root, DEFAULT_RULES_PATH);
  const repoMetricsPath = resolve(root, DEFAULT_METRICS_PATH);

  describe('PromQL Metric Extraction', () => {
    it('extracts simple metric names from comparison expressions', () => {
      const metrics = extractMetricsFromPromQL('ophirpay_webhook_queue_depth > 1000');
      expect(metrics).toEqual(['ophirpay_webhook_queue_depth']);
    });

    it('extracts multiple metrics from arithmetic differences and ratios', () => {
      const metrics = extractMetricsFromPromQL(
        'ophirpay_contract_balance - ophirpay_locked_balance < 0'
      );
      expect(metrics).toEqual(['ophirpay_contract_balance', 'ophirpay_locked_balance']);
    });

    it('extracts metrics through functions like rate(), abs(), histogram_quantile()', () => {
      const metrics = extractMetricsFromPromQL(
        'histogram_quantile(0.95, rate(ophirpay_payment_duration_seconds_bucket[5m])) > 30'
      );
      expect(metrics).toEqual(['ophirpay_payment_duration_seconds_bucket']);
    });

    it('ignores labels and label values within {...}', () => {
      const expr =
        'sum(rate(ophirpay_delivery_final_outcomes_total{delivery_type="webhook",final_outcome="failure"}[15m])) / ' +
        'clamp_min(sum(rate(ophirpay_delivery_final_outcomes_total{delivery_type="webhook"}[15m])), 1) > 0.25';
      const metrics = extractMetricsFromPromQL(expr);
      expect(metrics).toEqual(['ophirpay_delivery_final_outcomes_total']);
      expect(metrics).not.toContain('webhook');
      expect(metrics).not.toContain('failure');
      expect(metrics).not.toContain('delivery_type');
      expect(metrics).not.toContain('final_outcome');
    });

    it('ignores PromQL aggregators, boolean keywords, and numeric constants', () => {
      const expr = 'abs(ophirpay_contract_balance - ophirpay_locked_balance - ophirpay_unlocked_balance) > 10000000';
      const metrics = extractMetricsFromPromQL(expr);
      expect(metrics).toEqual([
        'ophirpay_contract_balance',
        'ophirpay_locked_balance',
        'ophirpay_unlocked_balance',
      ]);
      expect(metrics).not.toContain('abs');
      expect(metrics).not.toContain('10000000');
    });

    it('extracts standard metric "up" without treating it as a reserved word', () => {
      const metrics = extractMetricsFromPromQL('up{job="ophirpay"} == 0');
      expect(metrics).toEqual(['up']);
    });
  });

  describe('Route Metrics Extraction', () => {
    it('extracts counters, gauges, summaries, and histogram suffixes from route source', () => {
      const sampleRoute = `
# HELP test_counter Total test events
# TYPE test_counter counter
test_counter 1

# HELP test_histogram Latency observations
# TYPE test_histogram histogram
test_histogram_bucket{le="0.1"} 1
test_histogram_sum 10
test_histogram_count 1

# HELP test_summary Summary duration
# TYPE test_summary summary
test_summary_sum 5
test_summary_count 2
`;
      const exposed = extractMetricsFromRoute(sampleRoute);
      expect(exposed.has('test_counter')).toBe(true);
      expect(exposed.has('test_histogram')).toBe(true);
      expect(exposed.has('test_histogram_bucket')).toBe(true);
      expect(exposed.has('test_histogram_sum')).toBe(true);
      expect(exposed.has('test_histogram_count')).toBe(true);
      expect(exposed.has('test_summary')).toBe(true);
      expect(exposed.has('test_summary_sum')).toBe(true);
      expect(exposed.has('test_summary_count')).toBe(true);
    });
  });

  describe('Alert Rules & External Declarations Parsing', () => {
    it('associates # external: comments with the containing alert rule', () => {
      const rawYaml = `
groups:
  - name: test_grp
    rules:
      - alert: MyAlert
        # external: ext_metric_one, ext_metric_two
        expr: ext_metric_one + ext_metric_two > 10
`;
      const { rules, errors } = parseAlertRulesWithExternals(rawYaml);
      expect(errors).toHaveLength(0);
      expect(rules).toHaveLength(1);
      expect(rules[0].alert).toBe('MyAlert');
      expect(rules[0].external.has('ext_metric_one')).toBe(true);
      expect(rules[0].external.has('ext_metric_two')).toBe(true);
    });

    it('flags misplaced external declarations outside any alert block', () => {
      const fixturePath = resolve(root, 'tests/fixtures/prometheus/misplaced-declaration.yml');
      const result = validatePrometheusAlerts({
        rulesPath: fixturePath,
        metricsPath: repoMetricsPath,
      });
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes('Misplaced external declaration'))).toBe(true);
    });

    it('detects duplicate alert rule names', () => {
      const fixturePath = resolve(root, 'tests/fixtures/prometheus/duplicate-alert.yml');
      const result = validatePrometheusAlerts({
        rulesPath: fixturePath,
        metricsPath: repoMetricsPath,
      });
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes('Duplicate alert rule found: "DuplicateAlertName"'))).toBe(true);
    });
  });

  describe('Contract Balance Alerts Coverage', () => {
    it('fails when contract balance metrics are not exposed and not declared external', () => {
      const fixturePath = resolve(
        root,
        'tests/fixtures/prometheus/missing-contract-balance-declaration.yml'
      );
      const result = validatePrometheusAlerts({
        rulesPath: fixturePath,
        metricsPath: repoMetricsPath,
      });
      expect(result.success).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.includes('ContractBalanceBelowLocked') &&
            e.includes('ophirpay_contract_balance')
        )
      ).toBe(true);
      expect(
        result.errors.some(
          (e) =>
            e.includes('ContractBalanceBelowLocked') &&
            e.includes('ophirpay_locked_balance')
        )
      ).toBe(true);
    });
  });

  describe('Undeclared Metric Failures', () => {
    it('fails naming both the alert and the undeclared metric', () => {
      const fixturePath = resolve(root, 'tests/fixtures/prometheus/undeclared-metric.yml');
      const result = validatePrometheusAlerts({
        rulesPath: fixturePath,
        metricsPath: repoMetricsPath,
      });
      expect(result.success).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.includes('UndeliveredAlertWithTypo') &&
            e.includes('ophirpay_nonexistent_metric_typo')
        )
      ).toBe(true);
    });
  });

  describe('Full Repository Validation', () => {
    it('validates monitoring/prometheus-alerts.yml successfully against src/app/api/metrics/route.ts', () => {
      const result = validatePrometheusAlerts({
        rulesPath: repoRulesPath,
        metricsPath: repoMetricsPath,
      });
      const summary = result.summary as { rulesCount: number; uniqueMetrics: number };
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(summary.rulesCount).toBe(12);
      expect(summary.uniqueMetrics).toBe(14);
    });

    it('covers all critical alert rules including contract balance alerts', () => {
      const result = validatePrometheusAlerts({
        rulesPath: repoRulesPath,
        metricsPath: repoMetricsPath,
      });
      expect(result.success).toBe(true);
      // Contract balance alerts
      const rawRules = readFileSync(repoRulesPath, 'utf8');
      const { rules } = parseAlertRulesWithExternals(rawRules);
      const alertNames = rules.map((r) => r.alert);
      expect(alertNames).toContain('ContractBalanceBelowLocked');
      expect(alertNames).toContain('ContractBalanceDroppingFast');
      expect(alertNames).toContain('LockedBalanceDivergence');
      expect(alertNames).toContain('BatchPaymentFailureRateHigh');
      expect(alertNames).toContain('PaymentProcessingLatencyHigh');
      expect(alertNames).toContain('WebhookDeliveryFailureRateHigh');
      expect(alertNames).toContain('WebhookQueueDepthHigh');
      expect(alertNames).toContain('ApiHighErrorRate');
      expect(alertNames).toContain('ApiDown');
      expect(alertNames).toContain('DatabaseConnectionPoolExhausted');
      expect(alertNames).toContain('DatabaseQueryLatencyHigh');
      expect(alertNames).toContain('RateLimitHitsHigh');
    });

    it('promtool check rules succeeds with --lint-fatal when promtool is installed', () => {
      if (!hasPromtool()) {
        console.warn('promtool not installed in environment; skipping binary execution test.');
        return;
      }
      const promtoolRes = runPromtoolCheck(repoRulesPath);
      expect(promtoolRes.success).toBe(true);
      expect(promtoolRes.output).toContain('SUCCESS: 12 rules found');
    });
  });

  describe('CLI End-to-End Contract', () => {
    it('exits with code 0 on valid repository alerts file', () => {
      const cmd = `node scripts/validate-prometheus-alerts.mjs --rules "${repoRulesPath}" --metrics "${repoMetricsPath}"`;
      const output = execSync(cmd, { encoding: 'utf8', cwd: root });
      expect(output).toContain('Validation passed');
      expect(output).toContain('12 alert rule(s) checked');
    });

    it('exits with code 1 on undeclared metric fixture', () => {
      const fixturePath = resolve(root, 'tests/fixtures/prometheus/undeclared-metric.yml');
      const cmd = `node scripts/validate-prometheus-alerts.mjs --rules "${fixturePath}" --metrics "${repoMetricsPath}"`;
      expect(() => execSync(cmd, { encoding: 'utf8', cwd: root })).toThrow();
    });

    it('exits with code 1 on duplicate alert rule fixture', () => {
      const fixturePath = resolve(root, 'tests/fixtures/prometheus/duplicate-alert.yml');
      const cmd = `node scripts/validate-prometheus-alerts.mjs --rules "${fixturePath}" --metrics "${repoMetricsPath}"`;
      expect(() => execSync(cmd, { encoding: 'utf8', cwd: root })).toThrow();
    });
  });
});
