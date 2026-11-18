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

All metric references in the Grafana dashboard are validated against published metrics in `src/app/api/metrics/route.ts`.
