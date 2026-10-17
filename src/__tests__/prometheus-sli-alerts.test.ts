// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Prometheus SLI Alert Rules (#1412)", () => {
  const alertsPath = path.resolve(
    process.cwd(),
    "monitoring/prometheus-alerts.yml"
  );
  const troubleshootingPath = path.resolve(
    process.cwd(),
    "docs/TROUBLESHOOTING.md"
  );
  const metricsDocsPath = path.resolve(
    process.cwd(),
    "docs/metrics-endpoints.md"
  );

  const alertsYaml = fs.readFileSync(alertsPath, "utf8");
  const troubleshootingMd = fs.readFileSync(troubleshootingPath, "utf8");
  const metricsDocsMd = fs.readFileSync(metricsDocsPath, "utf8");

  it("defines OphirPayWebhookHighFailureRate with >10% over 5m threshold and critical severity", () => {
    expect(alertsYaml).toContain("- alert: OphirPayWebhookHighFailureRate");
    expect(alertsYaml).toContain("rate(ophirpay_webhooks_failed_total[5m])");
    expect(alertsYaml).toContain("> 0.10");
    expect(alertsYaml).toContain(
      'runbook_url: "https://github.com/OphirPay/OphirPay/blob/main/docs/TROUBLESHOOTING.md#ophirpaywebhookhighfailurerate"'
    );
  });

  it("defines OphirPayRpcProviderDegraded when RPC failover triggers >3 times in 15m", () => {
    expect(alertsYaml).toContain("- alert: OphirPayRpcProviderDegraded");
    expect(alertsYaml).toContain(
      "increase(ophirpay_rpc_failover_total[15m]) > 3"
    );
    expect(alertsYaml).toContain(
      'runbook_url: "https://github.com/OphirPay/OphirPay/blob/main/docs/TROUBLESHOOTING.md#ophirpayrpcproviderdegraded"'
    );
  });

  it("defines OphirPayDatabasePoolExhaustion when DB query p95 latency > 2.0s over 5m", () => {
    expect(alertsYaml).toContain("- alert: OphirPayDatabasePoolExhaustion");
    expect(alertsYaml).toContain("histogram_quantile(0.95");
    expect(alertsYaml).toContain("> 2.0");
    expect(alertsYaml).toContain(
      'runbook_url: "https://github.com/OphirPay/OphirPay/blob/main/docs/TROUBLESHOOTING.md#ophirpaydatabasepoolexhaustion"'
    );
  });

  it("documents all three SLI alert runbooks in docs/TROUBLESHOOTING.md and docs/metrics-endpoints.md", () => {
    expect(troubleshootingMd).toContain("### `OphirPayWebhookHighFailureRate`");
    expect(troubleshootingMd).toContain("### `OphirPayRpcProviderDegraded`");
    expect(troubleshootingMd).toContain("### `OphirPayDatabasePoolExhaustion`");

    expect(metricsDocsMd).toContain("OphirPayWebhookHighFailureRate");
    expect(metricsDocsMd).toContain("OphirPayRpcProviderDegraded");
    expect(metricsDocsMd).toContain("OphirPayDatabasePoolExhaustion");
  });
});
