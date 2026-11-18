# OphirPay Monitoring & Production Alerting Guide

This directory provides Prometheus alert rules, scraping configurations, and Grafana dashboard definitions for monitoring OphirPay payment infrastructure in staging and production environments.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Requirements & Authentication](#requirements--authentication)
- [Prometheus Scraping Configuration](#prometheus-scraping-configuration)
  - [1. Standalone Prometheus Scrape Job](#1-standalone-prometheus-scrape-job)
  - [2. Prometheus Helm Chart (`kube-prometheus-stack`)](#2-prometheus-helm-chart-kube-prometheus-stack)
  - [3. Prometheus Operator (`PodMonitor` / `ServiceMonitor`)](#3-prometheus-operator-podmonitor--servicemonitor)
- [Prometheus Alert Rules & Thresholds](#prometheus-alert-rules--thresholds)
  - [Payment Error Rate Spikes & Latency](#payment-error-rate-spikes--latency)
  - [RPC Connectivity Drops & Circuit Breaker Failovers](#rpc-connectivity-drops--circuit-breaker-failovers)
  - [Database & System Availability](#database--system-availability)
- [Grafana Dashboard Import & Visualizations](#grafana-dashboard-import--visualizations)
  - [Step-by-Step Import](#step-by-step-import)
  - [Key Dashboard Panels](#key-dashboard-panels)
- [Alert Runbooks & Mitigation](#alert-runbooks--mitigation)
- [Validating Monitoring Artifacts](#validating-monitoring-artifacts)

---

## Architecture Overview

OphirPay exposes application-level and infrastructure-level metrics at `GET /api/metrics` using the Prometheus text format.

```
┌────────────────────────────────────────────────────────┐
│                   OphirPay Pod / Host                  │
│  - /api/metrics endpoint (Next.js Node runtime)        │
│  - Protected by Bearer METRICS_TOKEN                   │
└───────────────────────────┬────────────────────────────┘
                            │ Scraped every 30s
                            ▼
┌────────────────────────────────────────────────────────┐
│                   Prometheus Server                    │
│  - Scrapes metrics with Bearer Authorization           │
│  - Evaluates alert-rules.yml / prometheus-alerts.yml   │
└──────────────┬──────────────────────────┬──────────────┘
               │                          │
               ▼                          ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│     Grafana Dashboard       │  │        Alertmanager         │
│  - Visualization Panels     │  │  - PagerDuty, Slack, Email  │
│  - grafana-dashboard.json   │  │  - On-call notification     │
└─────────────────────────────┘  └─────────────────────────────┘
```

---

## Requirements & Authentication

- **Scrape Endpoint**: `GET /api/metrics`
- **Authentication**: Bearer token authentication is strictly required. Unauthenticated requests return `401 Unauthorized`.
- **Token Generation**:
  ```bash
  openssl rand -hex 32
  ```
  Set this value as `METRICS_TOKEN` in OphirPay's environment and mount it as a secret accessible to Prometheus. Never expose `METRICS_TOKEN` in public Git repositories.
- **Grafana Compatibility**: Version 10.x or newer (dashboard schema version 39).
- **Rule Files**: `monitoring/prometheus-alerts.yml` (aliased to `monitoring/alert-rules.yml`).

---

## Prometheus Scraping Configuration

### 1. Standalone Prometheus Scrape Job

In your `prometheus.yml` configuration:

```yaml
scrape_configs:
  - job_name: ophirpay
    scrape_interval: 30s
    scrape_timeout: 10s
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/metrics-token
    static_configs:
      - targets: ["ophirpay.ophirpay.svc.cluster.local:80"]

rule_files:
  - /etc/prometheus/rules/prometheus-alerts.yml
```

### 2. Prometheus Helm Chart (`kube-prometheus-stack`)

When deploying Prometheus via the popular `kube-prometheus-stack` Helm chart, configure `additionalScrapeConfigs` in your values file:

```yaml
prometheus:
  prometheusSpec:
    ruleSelectorNilUsesHelmValues: false
    serviceMonitorSelectorNilUsesHelmValues: false
    additionalScrapeConfigs:
      - job_name: ophirpay
        metrics_path: /api/metrics
        scrape_interval: 30s
        authorization:
          type: Bearer
          credentials_file: /etc/prometheus/secrets/metrics-token
        kubernetes_sd_configs:
          - role: endpoints
            namespaces:
              names:
                - ophirpay
        relabel_configs:
          - source_labels: [__meta_kubernetes_service_name]
            action: keep
            regex: ophirpay
```

### 3. Prometheus Operator (`PodMonitor` / `ServiceMonitor`)

For native Kubernetes Custom Resources:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: ophirpay-metrics
  namespace: ophirpay
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: ophirpay
  endpoints:
    - port: http
      path: /api/metrics
      interval: 30s
      bearerTokenSecret:
        name: ophirpay-secrets
        key: METRICS_TOKEN
```

---

## Prometheus Alert Rules & Thresholds

Alert rules are defined in `monitoring/prometheus-alerts.yml` (and `monitoring/alert-rules.yml`). Prometheus continuously evaluates these expressions against the `ophirpay` scrape job.

### Payment Error Rate Spikes & Latency

#### 1. High API Error Rate (`ApiHighErrorRate`)

- **Trigger**: Error ratio (`5xx` errors divided by total requests) exceeds **5%** for 5 consecutive minutes:
  ```promql
  sum(rate(ophirpay_endpoint_request_errors_total[5m])) /
  sum(rate(ophirpay_endpoint_requests_total[5m])) > 0.05
  ```
- **Severity**: `critical`
- **Meaning**: Active payment or auth endpoints are failing for merchants or users.

#### 2. High Payment Processing Latency (`PaymentProcessingLatencyHigh`)

- **Trigger**: 95th percentile (p95) API response time exceeds **30 seconds** for 5 consecutive minutes:
  ```promql
  histogram_quantile(0.95, rate(ophirpay_endpoint_request_duration_seconds_bucket[5m])) > 30
  ```
- **Severity**: `warning`
- **Meaning**: Stellar RPC congestion, database query locks, or external network latency is slowing down payment settlement.

#### 3. Webhook Delivery Failure Rate (`WebhookDeliveryFailureRateHigh`)

- **Trigger**: Terminal webhook delivery failures exceed **25%** over a 15-minute window for 10 minutes:
  ```promql
  sum(rate(ophirpay_delivery_final_outcomes_total{delivery_type="webhook",final_outcome="failure"}[15m])) /
  sum(rate(ophirpay_delivery_final_outcomes_total{delivery_type="webhook"}[15m])) > 0.25
  ```
- **Severity**: `warning`
- **Meaning**: Merchant webhook endpoints are offline or rejecting signed callback notifications.

---

### RPC Connectivity Drops & Circuit Breaker Failovers

#### 1. Soroban RPC Degraded (`OphirPayRpcProviderDegraded`)

- **Trigger**: Primary Soroban RPC p95 latency exceeds **2.5s** or returns server errors for 3 minutes:
  ```promql
  histogram_quantile(0.95, rate(ophirpay_soroban_rpc_duration_seconds_bucket[5m])) > 2.5
  ```
- **Severity**: `critical`
- **Meaning**: Upstream Stellar Soroban RPC node is degraded or timing out.

#### 2. RPC Failover Active (`RpcFailoverDegraded`)

- **Trigger**: OphirPay has switched traffic to a fallback Soroban RPC endpoint for $\ge$ **2 minutes**:
  ```promql
  ophirpay_rpc_circuit_breaker_state{state="fallback"} == 1
  ```
- **Severity**: `warning`
- **Meaning**: Circuit breaker opened and routed queries to secondary RPC provider. Primary requires investigation.

#### 3. Frequent RPC Transitions (`RpcFailoverFrequent`)

- **Trigger**: At least **3 primary-to-fallback transitions** occur in 30 minutes, sustained for 5 minutes:
  ```promql
  increase(ophirpay_rpc_failover_transitions_total[30m]) >= 3
  ```
- **Severity**: `warning`
- **Meaning**: Intermittent network flap or flapping health checks between primary and secondary RPC endpoints.

---

### Database & System Availability

#### 1. API Down (`ApiDown`)

- **Trigger**: Prometheus target is unreachable (`up{job="ophirpay"} == 0`) for **2 minutes**:
  ```promql
  up{job="ophirpay"} == 0
  ```
- **Severity**: `critical`
- **Meaning**: Pods or instances are offline, crashing, or network partition has occurred.

#### 2. Database Connection Pool Exhaustion (`OphirPayDatabasePoolExhaustion`)

- **Trigger**: Prisma connection pool queue wait time exceeds **500ms** for 1 minute:
  ```promql
  rate(prisma_client_queries_wait_duration_ms[1m]) > 500
  ```
- **Severity**: `critical`
- **Meaning**: Database connection pool exhausted; queries are waiting on available database connections.

---

## Grafana Dashboard Import & Visualizations

A production-ready Grafana dashboard is supplied in [`monitoring/grafana-dashboard.json`](file:///C:/Users/USER/.gemini/antigravity/scratch/OphirPay/monitoring/grafana-dashboard.json).

### Step-by-Step Import

1. Open your Grafana web console (version 10.x+).
2. Ensure you have configured a Prometheus data source with the UID `prometheus`.
3. In the left-hand navigation menu, navigate to **Dashboards** $\rightarrow$ **Import** (`/dashboard/import`).
4. Click **Upload dashboard JSON file** and select `monitoring/grafana-dashboard.json`.
5. Select your Prometheus data source from the dropdown if prompted.
6. Click **Import**.

### Key Dashboard Panels

- **Payment Throughput & Settlement (QPS)**: Graph showing payment transaction volumes partitioned by status (`COMPLETED`, `PENDING`, `FAILED`).
- **HTTP Error Rate Ratio**: Gauge displaying error percentage against the 5% threshold.
- **Latency Heatmap (p50, p95, p99)**: Visualizes request durations across API routes and identifies outliers.
- **RPC Circuit Breaker Status**: Status indicators displaying health of primary and secondary Soroban RPC endpoints.
- **Active Escrows & Streams**: Real-time counter of on-chain locked assets.
- **Webhook Delivery Success vs Exhaustion**: Distribution of webhook retries and terminal failures.

---

## Alert Runbooks & Mitigation

When an alert triggers, follow these initial diagnostic steps before escalating:

1. **For `ApiHighErrorRate` or `PaymentProcessingLatencyHigh`**:
   - Check `GET /api/health` to determine if database or RPC connections are degraded.
   - Inspect application pod logs for stack traces or unhandled contract errors:
     ```bash
     kubectl logs -n ophirpay -l app.kubernetes.io/instance=ophirpay --tail=200
     ```
   - Check database query load on PostgreSQL or PgBouncer.
   - If error spike corresponds to a new release, initiate rollback:
     ```bash
     helm rollback ophirpay <previous-revision> -n ophirpay
     ```

2. **For `RpcFailoverDegraded` or `OphirPayRpcProviderDegraded`**:
   - Check status of configured Soroban RPC provider (e.g., Stellar Development Foundation, QuickNode, Blockdaemon).
   - Verify fallback endpoint is healthy by invoking `GET /api/health`.
   - **Do not pause contracts** simply because RPC failover is active; the circuit breaker is designed to self-heal once the primary recovers.

3. **For `ApiDown`**:
   - Distinguish network/scrape-credential failure from actual application crash.
   - Run `kubectl get pods -n ophirpay` to check for `CrashLoopBackOff` or OOM-kills.

---

## Validating Monitoring Artifacts

Before deploying monitoring updates to production, run the repository validation tools:

```bash
# Validate Prometheus alert rule syntax (requires promtool)
promtool check rules monitoring/prometheus-alerts.yml

# Validate Grafana dashboard schema and metric naming
node scripts/validate-grafana-dashboard.mjs
```

The validator checks dashboard identity, schema version, panel targets, and
that every referenced OphirPay metric is published by
`src/app/api/metrics/route.ts`.

## Alert runbooks

Prometheus evaluates the following nine rules from this file. Use the alert's
instance, labels, Prometheus graph, and application logs to confirm the
condition before taking corrective action.

| Alert                                         | Trigger                                                                                                                                                                                          | Initial response                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PaymentProcessingLatencyHigh` (`warning`)    | API request latency p95 above 30 seconds for 5 minutes. The expression evaluates each histogram label set (method, endpoint, and status class) separately; it does not filter to payment routes. | Check `GET /api/health`, application logs, database query latency, and Stellar/Soroban RPC health. Identify the slow route and whether requests are still completing. Before retrying or resubmitting a payment, check its database and on-chain state to avoid duplicate actions. |
| `WebhookDeliveryFailureRateHigh` (`warning`)  | Webhook final-outcome failure ratio above 25% over the 15-minute rate window for 10 minutes.                                                                                                     | Inspect `ophirpay_delivery_final_outcomes_total` and `ophirpay_delivery_attempts_total`, then review affected subscriber endpoints, HTTP status codes, and retry distribution. Confirm whether deliveries are exhausting retries; do not blindly replay a large backlog.           |
| `OphirPayWebhookHighFailureRate` (`warning`)  | Webhook delivery failure rate above 5% over a 5-minute rolling window.                                                                                                                           | Inspect subscriber endpoints, HTTP response codes, and retry distribution. Verify recipient webhook servers are online.                                                                                                                                                            |
| `OphirPayRpcProviderDegraded` (`critical`)    | Soroban RPC p95 latency above 2.5s or returning 5xx server errors for at least 3 minutes.                                                                                                        | Inspect `GET /api/health` failover state, upstream RPC provider status, and node error rates. Verify fallback endpoints are operational.                                                                                                                                           |
| `OphirPayDatabasePoolExhaustion` (`critical`) | Prisma connection pool queue wait time above 500ms for 1 minute.                                                                                                                                 | Connection pool is exhausted. Review long-running queries, connection limits, and database pooler (PgBouncer/Neon) settings.                                                                                                                                                       |
| `ApiHighErrorRate` (`critical`)               | Endpoint errors divided by HTTP requests above 5% for 5 minutes.                                                                                                                                 | Check the erroring routes/status classes, application logs, recent deployments, database health, and RPC dependencies. If a recent release caused the errors, follow the deployment rollback procedure; otherwise mitigate the failing dependency and monitor recovery.            |
| `ApiDown` (`critical`)                        | Prometheus reports `up{job="ophirpay"} == 0` for 2 minutes.                                                                                                                                      | Check the Prometheus target and scrape errors first, then verify the service, pods/instances, ingress, and `GET /api/health`. Distinguish an application outage from a network, DNS, or scrape-credential problem. A missing target series is not the same as this alert firing.   |
| `RpcFailoverDegraded` (`warning`)             | OphirPay has used a fallback Soroban RPC endpoint for 2 minutes.                                                                                                                                 | Check the named endpoint, `GET /api/health` failover details, RPC provider status, and app logs. Verify the fallback is responding before changing provider configuration. Do not pause the contract merely because RPC failover is active.                                        |
| `RpcFailoverFrequent` (`warning`)             | At least three primary-to-fallback transitions in 30 minutes, sustained for 5 minutes.                                                                                                           | Investigate primary provider instability and probe results. Compare failovers with recovery metrics and recent endpoint/configuration changes; stabilize the upstream before forcing a switch back.                                                                                |

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
