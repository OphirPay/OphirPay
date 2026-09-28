# Grafana dashboard

`grafana-dashboard.json` targets Grafana dashboard schema version 39 and is
intended for Grafana 10.x and newer. Import it with Prometheus configured as a
data source using the UID `prometheus`.

Validate the shipped artifact before importing it:

```bash
node scripts/validate-grafana-dashboard.mjs
```

The validator checks the JSON structure, required dashboard identity, panel
targets, and every `ophirpay_*` metric referenced by PromQL against the metric
families emitted by `src/app/api/metrics/route.ts`. A panel that references an
unknown metric fails with both its title and the metric name.

## Alerts and operations

`prometheus-alerts.yml` holds the Prometheus alert rules. Validate them with
`promtool check rules monitoring/prometheus-alerts.yml` before loading.

The full operator guide is in [`docs/OBSERVABILITY.md`](../docs/OBSERVABILITY.md):
the authenticated scrape configuration (`/api/metrics` needs
`Authorization: Bearer <METRICS_TOKEN>`), dashboard import and provisioning,
Alertmanager routing, and a runbook entry for every alert (what it means, first
actions, how to pause the contract, how to escalate).

Note that several alert rules reference metrics the application does not export
yet, so they cannot fire; the guide lists which. When you add a rule to
`prometheus-alerts.yml`, add its runbook entry to `docs/OBSERVABILITY.md`
(`src/__tests__/docs-observability.test.ts` fails otherwise).
