# OphirPay Monitoring

This directory contains a Prometheus rule file and a Grafana dashboard. The
rule file is **not** an Alertmanager configuration: it defines Prometheus
alerts and labels only. You must configure Prometheus scraping and separately
route alerts through your Alertmanager receivers (PagerDuty, Slack, or another
on-call system).

## Requirements

- Prometheus scraping `GET /api/metrics` with an authenticated bearer token.
- A Grafana 10.x-or-newer server; the dashboard uses schema version 39.
- Alertmanager configuration and receiver credentials managed separately
  from this repository if you want notifications.

`/api/metrics` is protected. Set a strong `METRICS_TOKEN` on the OphirPay
deployment and mount the same value as a file readable by Prometheus. Generate
one with:

```bash
openssl rand -hex 32
```

Do not place the token in this repository or in a public scrape URL.

## Configure Prometheus

Use a scrape job named `ophirpay`; `ApiDown` checks
`up{job="ophirpay"}`. Replace the example target with the address Prometheus
can reach. In Kubernetes, mount the token secret at the configured file path.

```yaml
scrape_configs:
  - job_name: ophirpay
    scrape_interval: 30s
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/metrics-token
    static_configs:
      - targets: ["ophirpay.ophirpay.svc.cluster.local:80"]

rule_files:
  - /etc/prometheus/rules/monitoring/prometheus-alerts.yml
```

The credentials file contains only the token value. For Prometheus Operator,
configure equivalent scrape authentication on the `ServiceMonitor` or
`PodMonitor`; pod annotations cannot supply the authorization header. See
[Per-Endpoint Metrics](../docs/metrics-endpoints.md) for the endpoint's
authentication behavior and a more detailed scrape example.

After reloading Prometheus, confirm the `ophirpay` target is **UP** and that
the metric families used by the rules are present. Validate the rules before
deployment:

```bash
promtool check rules monitoring/prometheus-alerts.yml
```

CI currently runs this check with `promtool` 2.45.0. The rules emit
`severity=warning` or `severity=critical` labels; configure Alertmanager routes
for those labels and define your own receiver integrations and secrets there.
The alert rule file alone does not send email, PagerDuty, or Slack messages.

## Import the Grafana dashboard

1. In Grafana, add a Prometheus data source with the UID `prometheus`.
2. Open **Dashboards → Import** and upload
   `monitoring/grafana-dashboard.json`.
3. Select the Prometheus data source (UID `prometheus`) if prompted, then
   import and confirm the panels return data.

The dashboard refreshes every 30 seconds. Its metrics are process-local and
can reset on restart/deployment; inspect per-instance series and scrape
continuity before interpreting counter resets as application failures.

Validate the artifact before import:

```bash
node scripts/validate-grafana-dashboard.mjs
```

The validator checks dashboard identity, schema version, panel targets, and
that every referenced OphirPay metric is published by
`src/app/api/metrics/route.ts`.

## Alert runbooks

Prometheus evaluates the following six rules from this file. Use the alert's
instance, labels, Prometheus graph, and application logs to confirm the
condition before taking corrective action.

| Alert | Trigger | Initial response |
|---|---|---|
| `PaymentProcessingLatencyHigh` (`warning`) | API request latency p95 above 30 seconds for 5 minutes. The expression evaluates each histogram label set (method, endpoint, and status class) separately; it does not filter to payment routes. | Check `GET /api/health`, application logs, database query latency, and Stellar/Soroban RPC health. Identify the slow route and whether requests are still completing. Before retrying or resubmitting a payment, check its database and on-chain state to avoid duplicate actions. |
| `WebhookDeliveryFailureRateHigh` (`warning`) | Webhook final-outcome failure ratio above 25% over the 15-minute rate window for 10 minutes. | Inspect `ophirpay_delivery_final_outcomes_total` and `ophirpay_delivery_attempts_total`, then review affected subscriber endpoints, HTTP status codes, and retry distribution. Confirm whether deliveries are exhausting retries; do not blindly replay a large backlog. |
| `ApiHighErrorRate` (`critical`) | Endpoint errors divided by HTTP requests above 5% for 5 minutes. | Check the erroring routes/status classes, application logs, recent deployments, database health, and RPC dependencies. If a recent release caused the errors, follow the deployment rollback procedure; otherwise mitigate the failing dependency and monitor recovery. |
| `ApiDown` (`critical`) | Prometheus reports `up{job="ophirpay"} == 0` for 2 minutes. | Check the Prometheus target and scrape errors first, then verify the service, pods/instances, ingress, and `GET /api/health`. Distinguish an application outage from a network, DNS, or scrape-credential problem. A missing target series is not the same as this alert firing. |
| `RpcFailoverDegraded` (`warning`) | OphirPay has used a fallback Soroban RPC endpoint for 2 minutes. | Check the named endpoint, `GET /api/health` failover details, RPC provider status, and app logs. Verify the fallback is responding before changing provider configuration. Do not pause the contract merely because RPC failover is active. |
| `RpcFailoverFrequent` (`warning`) | At least three primary-to-fallback transitions in 30 minutes, sustained for 5 minutes. | Investigate primary provider instability and probe results. Compare failovers with recovery metrics and recent endpoint/configuration changes; stabilize the upstream before forcing a switch back. |

### Contract-balance alerts and pausing

There is **no active contract-balance alert** in the checked-in
`prometheus-alerts.yml`; the old section marker is not a rule. Do not pause a
contract in response to a nonexistent built-in alert or infer a balance issue
from a generic API/RPC alert. If an operator adds a contract-balance alert,
first verify the network, contract address, current on-chain balance, and
locked liabilities using an independent read. Establish a reviewed threshold
and escalation procedure before attaching any automated action.

Pausing is an owner-authorized, on-chain operational decision, not an automatic
alert side effect. The global `emergency_pause_all` stops all state-changing
operations and, when an Emitter is linked, pauses it atomically as well;
read-only queries remain available. Its blast radius includes payments,
escrows, streams, recurring payments, refunds, governance, hooks, and batches.
Where only one subsystem is affected, consider the owner-only
`set_scope_paused` control instead (scope IDs: Payments 0, Escrows 1, Streams
2, Recurring 3, Refunds 4, Governance 5, Hooks 6, Batches 7). See
[Contract Function Reference](../docs/CONTRACT_FUNCTION_REFERENCE.md) and
[Contract Architecture](../docs/CONTRACT_ARCHITECTURE.md) before operating
either control; coordinate with the contract owner and record the decision.
