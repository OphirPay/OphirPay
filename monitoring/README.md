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
