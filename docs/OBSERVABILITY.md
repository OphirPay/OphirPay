# Observability — Monitoring, Alerts and Runbooks

Issue #783 — Document how to import the Grafana dashboard and route the Prometheus alerts.

## Prerequisites

- Prometheus server (2.40+ recommended) scraping the OphirPay API `/api/metrics` endpoint
- Grafana (9.0+) with the Prometheus datasource configured
- Alertmanager (optional, for routing alerts to PagerDuty/Slack)

## Metrics Endpoint

The OphirPay API exposes Prometheus metrics at `/api/metrics`.

### Access

- **Production**: `/api/metrics` requires authentication (METRICS_TOKEN header or X-Metrics-Token query parameter). See docs/metrics-endpoints.md for the full credential setup.
- **Development**: uses the same endpoint; configure METRICS_TOKEN in your `.env` or leave it unset and the dev server exposes it without auth (not recommended for production).

### Scrape Configuration

Add a scrape job to your Prometheus configuration:

```yaml
scrape_configs:
  - job_name: 'ophirpay'
    static_configs:
      - targets: ['ophirpay-api:8080']
    metrics_path: '/api/metrics'
    headers:
      'X-Metrics-Token': '<your-metrics-token>'  # if auth is enabled
    scrape_interval: 15s
    scrape_timeout: 10s
```

Replace `ophirpay-api:8080` with your actual OphirPay API host and port.

## Grafana Dashboard

A pre-built dashboard is shipped at `monitoring/grafana-dashboard.json`.

### Supported Grafana Version

Grafana 9.0+ (tested against 10.x). The dashboard uses standard Prometheus queries and should work with any recent Prometheus datasource.

### Import Steps

1. Open Grafana in your browser and navigate to **Dashboards** → **Import**.
2. Click **Upload dashboard JSON file** and select `monitoring/grafana-dashboard.json` from the OphirPay repository.
3. Select the Prometheus datasource from the dropdown (must be pre-configured).
4. Click **Import**.

The dashboard includes panels for:

- Platform Health (stat): HTTP requests, payments created, webhooks delivered
- HTTP Request Rate (timeseries): requests per second over 5m window
- Payments Created vs Failed (timeseries): success vs failure counts
- Webhook Delivery Rate (timeseries): successful vs failed webhook deliveries
- Database Query Latency (timeseries): p95 query duration
- API Error Rate (stat): percentage of requests resulting in errors

## Alert Rules

Alert rules are defined in `monitoring/prometheus-alerts.yml`. Each rule includes a severity, the Prometheus expression that triggers it, and a description of what to do when it fires.

Load the rules into Prometheus:

```yaml
rule_files:
  - 'monitoring/prometheus-alerts.yml'
```

### Alert Runbooks

#### ContractBalanceBelowLocked (critical, contract)

**What it means:** The contract's on-chain balance has dropped below the total of locked escrow + active stream funds. This indicates a potential fund deficiency or accounting bug.

**First actions:**
1. Verify current contract balance via Stellar explorer or `get_contract_balance` RPC call.
2. Check recent withdrawals: are there any unusual large withdrawals?
3. If balance is genuinely below locked funds, **pause the contract immediately** using the pause controls.
4. Investigate the accounting: compare on-chain balance with the locked balance tracked in the database.

**How to pause the contract:**
- Via the admin UI: Pause Controls page → Emergency Pause
- Via API: `POST /api/pause-controls/pause` (admin authentication required)

**How to escalate:**
- If the deficiency cannot be explained by normal operations, escalate to the core team. Do not resume the contract until the discrepancy is resolved.

#### ContractBalanceDroppingFast (warning, contract)

**What it means:** Contract balance is decreasing rapidly (> $10/s). Could indicate unusual withdrawal activity or a streaming payout spike.

**First actions:**
1. Check recent withdrawals in the database or via the contract events.
2. Verify that streaming payouts are within expected ranges.
3. If the rate doesn't normalize within 5 minutes, consider pausing the contract as a precaution.

**Escalation:** If you cannot identify the cause, escalate to the core team.

#### LockedBalanceDivergence (warning, contract)

**What it means:** The sum of locked + unlocked balances doesn't match the contract balance. This is an invariant violation — the accounting state has diverged from the on-chain state.

**First actions:**
1. Re-sync the locked balance from the contract: `GET /api/contracts/[id]/balance-sync`.
2. Verify the database's locked balance matches the contract's expected locked amount.
3. If the re-sync doesn't fix the divergence, check for recent state changes or migrations that may have affected the accounting.

**Escalation:** If divergence persists after re-sync, escalate. This needs investigation before the contract resumes processing.

#### BatchPaymentFailureRateHigh (critical, payments)

**What it means:** More than 50% of batch payment items are failing over a 15-minute window.

**First actions:**
1. Check RPC connectivity to Stellar Horizon and Soroban RPC.
2. Check token contract state: is the token contract healthy and reachable?
3. Look at recent batch operations for patterns (specific tokens, specific destinations).
4. If RPC is the issue, check the RPC failover status — the app should have switched to a backup endpoint.

**Escalation:** If RPC failover hasn't triggered and the batch failure rate remains high for more than 10 minutes, escalate.

#### PaymentProcessingLatencyHigh (warning, payments)

**What it means:** P95 payment processing time exceeds 30 seconds. Payments are still succeeding, but users are experiencing slowdowns.

**First actions:**
1. Check Stellar RPC latency and error rates.
2. Check database query latency (DBQueryLatencyHigh may also be firing).
3. Check if there's a spike in concurrent payment requests.

**Escalation:** If latency remains high for more than 10 minutes and RPC/DB are healthy, escalate for performance investigation.

#### WebhookDeliveryFailureRateHigh (warning, webhooks)

**What it means:** More than 25% of webhook deliveries have ended in failure for at least 10 minutes.

**First actions:**
1. Check the webhook subscriber endpoints: are any down or returning errors?
2. Check the webhook queue depth (WebhookQueueDepthHigh may also be firing).
3. Look at the delivery logs for specific failed endpoints.
4. If a specific endpoint is failing repeatedly, check if the subscriber has published an incident.

**Escalation:** If the failure rate doesn't improve after 15 minutes, escalate. Subscribers may need to be notified to fix their endpoints.

#### WebhookQueueDepthHigh (warning, webhooks)

**What it means:** Webhook delivery queue has more than 1000 pending items.

**First actions:**
1. Check the webhook worker health — is the worker process running and responsive?
2. Check for failing deliveries that are blocking the queue (items that can't be delivered are retried with backoff).
3. If the queue is growing because of a failing endpoint, consider temporarily disabling that subscriber or increasing retry limits.

**Escalation:** If the queue continues to grow for more than 10 minutes, escalate. Stale webhook deliveries may need manual intervention.

#### ApiHighErrorRate (critical, api)

**What it means:** The API is returning errors for more than 5% of requests over a 5-minute window.

**First actions:**
1. Check the API logs for the error messages — look for patterns (specific endpoints, specific error types).
2. Check downstream dependencies: RPC, database, contract.
3. If the error is a 5xx, it's likely a server-side issue. If 4xx, it may be client behavior.
4. If the error rate is from a single endpoint, investigate that endpoint specifically.

**Escalation:** If the error rate exceeds 10% for more than 5 minutes, escalate immediately.

#### ApiDown (critical, api)

**What it means:** The OphirPay API server is not responding to health checks for more than 2 minutes.

**First actions:**
1. Check if the API process is still running: `ps aux | grep ophirpay` or check the container/process manager.
2. If the process is down, restart it.
3. If the process is up but not responding, check logs for deadlocks, OOM errors, or resource exhaustion.
4. Check database connectivity — if the database is down, the API may be unable to respond.

**Escalation:** If the API can't be restarted within 5 minutes, escalate to infrastructure/emergency response.

#### DatabaseConnectionPoolExhausted (critical, database)

**What it means:** Only 2 or fewer database connections are available in the pool.

**First actions:**
1. Check for connection leaks: are there queries that aren't being closed properly?
2. Check database server load: CPU, memory, disk I/O.
3. Increase the pool size temporarily if the database can handle it.
4. Check for long-running queries that may be holding connections.

**Escalation:** If connections remain exhausted after increasing the pool size, escalate. There may be a connection leak or database resource issue.

#### DatabaseQueryLatencyHigh (warning, database)

**What it means:** P95 database query time exceeds 1 second.

**First actions:**
1. Check for slow queries in the database logs.
2. Check for missing indexes on frequently queried tables.
3. Check database server load and resource usage.
4. If a specific query is slow, investigate whether it needs an index or refactoring.

**Escalation:** If latency remains high for more than 10 minutes, escalate for performance investigation.

#### RateLimitHitsHigh (warning, api)

**What it means:** More than 10 rate limit hits per second.

**First actions:**
1. Check the IP distribution — is this a single IP or distributed?
2. If it's a single IP, it may be a misconfigured client or an attack.
3. If distributed, it may be legitimate traffic spike or a coordinated attack.
4. Check if the rate limit thresholds need adjustment for the current traffic pattern.

**Escalation:** If the rate limit hits are from an attack pattern, escalate to security.

## Metrics Endpoint Access Requirements

The `/api/metrics` endpoint exposes:

- Process memory usage
- Per-endpoint error rates and latencies
- Contract balance and locked balance
- Payment and webhook metrics
- Database connection pool status

**Access control:**
- Requires a metrics token (configured via `METRICS_TOKEN` environment variable)
- The token should be kept secret and rotated regularly
- In production, restrict network access to the metrics endpoint to Prometheus server IPs only

**Current limitation:** The metrics endpoint is publicly accessible (no authentication) until the authentication work in issue #XXX is completed. Until then, restrict access at the network level (firewall, VPN, or private network).

## Alertmanager Routing

The alert rules are designed for Alertmanager with routing to PagerDuty or Slack.

Example Alertmanager configuration:

```yaml
route:
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
    - match:
        severity: warning
      receiver: 'slack-warnings'

receivers:
  - name: 'default'
    email_configs:
      - to: 'ops-team@example.com'
  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: '<pagerduty-service-key>'
  - name: 'slack-warnings'
    slack_configs:
      - api_url: '<slack-webhook-url>'
        channel: '#ophirpay-alerts'
```

## Limitations

- The metrics endpoint does not currently require authentication. This is a known limitation and will be addressed in a future update. Until then, restrict access at the network level.
- The Grafana dashboard is a starting point — customize it for your specific deployment.
- Alert thresholds are initial recommendations and should be tuned based on your deployment's normal behavior.
