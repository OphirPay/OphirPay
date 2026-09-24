# Monitoring

Operational configuration for OphirPay's Prometheus + Grafana stack.

| File | Purpose |
| --- | --- |
| [`prometheus-alerts.yml`](prometheus-alerts.yml) | Prometheus alerting rules (Alertmanager → PagerDuty/Slack). |
| [`grafana-dashboard.json`](grafana-dashboard.json) | Grafana dashboard operators import to watch the API's `/api/metrics` endpoint. |

## Grafana compatibility

`grafana-dashboard.json` is pinned to the Grafana dashboard JSON schema **schemaVersion 39** —
the schema written by Grafana 10.3 through 11.2 (the Grafana 11.x line). Grafana
migrates older dashboard schemas forward automatically on import, so the dashboard
also loads on newer releases (11.3+, 12.x); a re-export from those versions would
raise `schemaVersion` to 40 or 41.

The expected value is enforced in two places, updated together on purpose:

- `SUPPORTED_SCHEMA_VERSION = 39` in [`../scripts/validate-grafana-dashboard.mjs`](../scripts/validate-grafana-dashboard.mjs)
- [`../src/__tests__/grafana-dashboard.test.ts`](../src/__tests__/grafana-dashboard.test.ts), which asserts the constant matches the checked-in dashboard

When upgrading the dashboard (re-exported from a newer Grafana), update
`SUPPORTED_SCHEMA_VERSION`, this section, and re-run the validator.

## Dashboard ⇄ metrics contract

Every metric a panel queries (`panels[].targets[].expr`) must actually be exposed by
[`../src/app/api/metrics/route.ts`](../src/app/api/metrics/route.ts) — the Prometheus
endpoint scraped in production. The check is strict: there is no allowlist, so a
dashboard that silently queries a renamed or removed metric (and would render
"No data" panels) fails CI with the panel title and the metric named. If the
dashboard ever needs a metric the API does not publish, extend the check
deliberately (for example an explicit external-metrics allowlist) instead of
weakening it.

## Running the check

```bash
# validate the checked-in dashboard
node scripts/validate-grafana-dashboard.mjs

# validate a downloaded dashboard export instead
node scripts/validate-grafana-dashboard.mjs --dashboard /tmp/grafana-export.json
```

[`../.github/workflows/monitoring-validation.yml`](../.github/workflows/monitoring-validation.yml)
runs the same script on pull requests that touch `monitoring/**`, the metrics route,
the validator, its test or its fixtures (targeting `main` and `integration/staging`),
so dashboard drift fails review instead of production.

## Importing the dashboard

1. Grafana → Dashboards → New → Import.
2. Upload or paste `grafana-dashboard.json`.
3. Pick the Prometheus datasource — the panels expect the datasource uid `prometheus`.
