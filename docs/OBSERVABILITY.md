# Observability: scraping, dashboard and alerts

This guide is the operator entry point for monitoring OphirPay. It covers how to
scrape the metrics endpoint, how to import the Grafana dashboard, how to route
the Prometheus alerts, and what to do when each alert fires.

| Artifact | Location |
| --- | --- |
| Metrics endpoint | `GET /api/metrics` (`src/app/api/metrics/route.ts`) |
| Metric catalogue and auth details | [`docs/metrics-endpoints.md`](./metrics-endpoints.md) |
| Grafana dashboard | [`monitoring/grafana-dashboard.json`](../monitoring/grafana-dashboard.json) |
| Alert rules | [`monitoring/prometheus-alerts.yml`](../monitoring/prometheus-alerts.yml) |
| Health endpoint | `GET /api/health` (readiness), `GET /api/health/live` (liveness) |

> **Read [Known limitations](#known-limitations) before relying on the alerts.**
> Several alert rules reference metrics the application does not emit yet, so
> they cannot fire today.

---

## 1. Scrape configuration

### Endpoint and credential

| Setting | Value |
| --- | --- |
| Path | `/api/metrics` |
| Format | Prometheus text exposition, `text/plain; version=0.0.4` |
| Credential | `Authorization: Bearer <METRICS_TOKEN>` |
| Alternative credential | An API key with the `admin` scope, sent as `Authorization: Bearer <key>` or `X-API-Key: <key>` |
| Unauthenticated response | `401` with a JSON error and **no metric body** |

The endpoint fails closed: if `METRICS_TOKEN` is unset on the app and the request
carries no admin API key, every scrape gets `401`.

Generate a token and set it on the app (Helm: `secrets.METRICS_TOKEN` in
`helm/ophirpay/values.yaml`; other deployments: the `METRICS_TOKEN` environment
variable, see `.env.example`):

```bash
openssl rand -hex 32
```

Verify the credential before wiring Prometheus:

```bash
# Expect 200 and a body starting with "# HELP ophirpay_http_requests_total"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $METRICS_TOKEN" https://<host>/api/metrics

# Expect 401 (no metric body)
curl -sS -o /dev/null -w '%{http_code}\n' https://<host>/api/metrics
```

### Prometheus job

Store the token in a file readable by Prometheus (a mounted Kubernetes Secret,
for example) and reference it with `credentials_file`. Do not inline the token in
`prometheus.yml`.

```yaml
scrape_configs:
  - job_name: ophirpay          # must stay "ophirpay": ApiDown matches up{job="ophirpay"}
    metrics_path: /api/metrics
    scheme: https
    scrape_interval: 30s
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/metrics-token   # value of METRICS_TOKEN
    static_configs:
      - targets: ["ophirpay.example.com:443"]

rule_files:
  - /etc/prometheus/rules/prometheus-alerts.yml   # monitoring/prometheus-alerts.yml
```

Two operational details matter here:

- **The job name is load-bearing.** `ApiDown` evaluates `up{job="ophirpay"} == 0`.
  With any other job name that alert never matches.
- **A bad token looks like an outage.** Prometheus records a non-2xx scrape as
  `up == 0`, so a missing, rotated or mistyped `METRICS_TOKEN` fires `ApiDown`
  even though the API is healthy. The first check in the `ApiDown` runbook
  separates the two cases.

### Kubernetes and the Prometheus Operator

The Helm chart's `prometheus.io/*` pod annotations advertise the path and port,
but annotations cannot carry a header, so the scrape job must attach the token
itself. With the Prometheus Operator, put an `authorization` block referencing
the Secret on the `ServiceMonitor` or `PodMonitor`:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: ophirpay
spec:
  selector:
    matchLabels:
      app: ophirpay
  endpoints:
    - port: http
      path: /api/metrics
      interval: 30s
      authorization:
        type: Bearer
        credentials:
          name: ophirpay-secrets
          key: METRICS_TOKEN
```

Adjust the selector labels and port name to match your Service.

**Scrape every pod, not the Service.** The counters live in each process's memory
and reset on restart. Scraping through a load-balanced Service returns a
different replica's counters on each scrape, which produces spurious counter
resets and meaningless `rate()` values. A `ServiceMonitor` scrapes each endpoint
separately, and `kubernetes_sd_configs` with `role: pod` does the same for a
plain Prometheus. With more than one replica, aggregate in queries with
`sum by (...)`.

---

## 2. Grafana dashboard

### Compatibility

`monitoring/grafana-dashboard.json` uses dashboard schema version **39** and
targets **Grafana 10.x and newer**. It is not intended for Grafana 9 or older.

The panels reference the data source by UID (`{"type": "prometheus", "uid":
"prometheus"}`) and the file has no `__inputs` block, so the import dialog will
not offer a data source picker. **Your Prometheus data source must have the UID
`prometheus`**, or the panels will show "datasource not found".

### Validate the artifact

```bash
node scripts/validate-grafana-dashboard.mjs
```

The validator checks the JSON structure and that every `ophirpay_*` metric in a
panel query is one the metrics endpoint emits.

### Import steps (UI)

1. In Grafana, open **Connections → Data sources → Add data source → Prometheus**.
   Point it at your Prometheus server. Open **Settings** and set the data source
   UID to `prometheus`. Grafana only lets you choose a UID when the data source is
   created, so if one already exists with a different UID, create a new one, or
   provision it as below.
2. Click **Save & test**. It must report success.
3. Open **Dashboards → New → Import**.
4. Click **Upload dashboard JSON file** and choose
   `monitoring/grafana-dashboard.json`. Or paste the file's contents into the
   text box.
5. Choose a folder, keep the UID `ophirpay`, and click **Import**.
6. Open **OphirPay — Payment Infrastructure**. The default range is the last 6
   hours with a 30 second refresh. Panels fill in once Prometheus has scraped for
   a few intervals.

Re-importing the same file with the same UID overwrites the dashboard, so
importing a newer copy from the repo is the upgrade path.

### Provisioning (repeatable)

To manage the data source and dashboard as code, use Grafana provisioning:

```yaml
# /etc/grafana/provisioning/datasources/ophirpay.yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

```yaml
# /etc/grafana/provisioning/dashboards/ophirpay.yaml
apiVersion: 1
providers:
  - name: ophirpay
    type: file
    options:
      path: /var/lib/grafana/dashboards/ophirpay   # copy grafana-dashboard.json here
```

### Panels

| Panel | Query basis |
| --- | --- |
| Platform Health | Current values of the request, payment and webhook counters |
| HTTP Request Rate | `rate(ophirpay_http_requests_total[5m])` |
| Payments: Created vs Failed | `ophirpay_payments_created_total`, `ophirpay_payments_failed_total` |
| Webhook Delivery Health | `ophirpay_webhooks_delivered_total`, `ophirpay_webhooks_failed_total` |
| Database Query Latency (avg) | `ophirpay_db_query_duration_seconds_sum / _count` |
| Batch Processing Volume | `rate(ophirpay_batches_processed_total[5m])` |

---

## 3. Alert rules and routing

### Load and check the rules

`monitoring/prometheus-alerts.yml` defines one group, `ophirpay_critical`,
evaluated every 30 seconds. Validate it and load it with Prometheus:

```bash
promtool check rules monitoring/prometheus-alerts.yml
```

Then reference it from `rule_files` (see the scrape example above) and reload
Prometheus. Configure Prometheus's `alerting:` block to point at your
Alertmanager.

### Route by label

Every alert carries a `severity` (`critical` or `warning`) and a `component`
(`contract`, `payments`, `webhooks`, `api`, `database`, `rpc`). Route on those.
An example Alertmanager configuration, with receivers you must fill in:

```yaml
route:
  receiver: slack-ophirpay
  group_by: [alertname, component]
  routes:
    - matchers: [severity="critical"]
      receiver: pagerduty-ophirpay
      repeat_interval: 1h
    - matchers: [severity="warning"]
      receiver: slack-ophirpay
      repeat_interval: 4h

receivers:
  - name: pagerduty-ophirpay
    pagerduty_configs:
      - routing_key_file: /etc/alertmanager/secrets/pagerduty-routing-key
  - name: slack-ophirpay
    slack_configs:
      - api_url_file: /etc/alertmanager/secrets/slack-webhook-url
        channel: "#ophirpay-alerts"
        title: "{{ .CommonAnnotations.summary }}"
```

`ContractBalanceBelowLocked` is the alert that indicates possible loss of funds.
Give it a dedicated route so it reaches a human immediately even if a broader
route is muted or grouped.

### Alert summary

"Emitted today" says whether every metric in the rule's expression is currently
exposed by `/api/metrics`. When it is **No**, the rule loads and evaluates but
never fires (see [Known limitations](#known-limitations)).

| Alert | Severity | Component | Fires when | Emitted today |
| --- | --- | --- | --- | --- |
| [`ContractBalanceBelowLocked`](#contractbalancebelowlocked) | critical | contract | balance is below locked funds for 1m | No |
| [`ContractBalanceDroppingFast`](#contractbalancedroppingfast) | warning | contract | balance falls faster than 1e10/s for 5m | No |
| [`LockedBalanceDivergence`](#lockedbalancedivergence) | warning | contract | balance − locked − unlocked exceeds 1e7 for 5m | No |
| [`BatchPaymentFailureRateHigh`](#batchpaymentfailureratehigh) | critical | payments | over 50% of batch items fail for 10m | No |
| [`PaymentProcessingLatencyHigh`](#paymentprocessinglatencyhigh) | warning | payments | payment p95 above 30s for 5m | No |
| [`WebhookDeliveryFailureRateHigh`](#webhookdeliveryfailureratehigh) | warning | webhooks | over 25% of final webhook outcomes fail for 10m | Yes |
| [`WebhookQueueDepthHigh`](#webhookqueuedepthhigh) | warning | webhooks | queue above 1000 for 5m | No |
| [`ApiHighErrorRate`](#apihigherrorrate) | critical | api | over 5% of requests error for 5m | No |
| [`ApiDown`](#apidown) | critical | api | scrape target down for 2m | Yes |
| [`DatabaseConnectionPoolExhausted`](#databaseconnectionpoolexhausted) | critical | database | fewer than 2 free connections for 2m | No |
| [`DatabaseQueryLatencyHigh`](#databasequerylatencyhigh) | warning | database | query p95 above 1s for 5m | No |
| [`RpcFailoverDegraded`](#rpcfailoverdegraded) | warning | rpc | on a fallback RPC endpoint for 2m | Yes |
| [`RpcFailoverFrequent`](#rpcfailoverfrequent) | warning | rpc | 3 or more failovers in 30m | Yes |
| [`RateLimitHitsHigh`](#ratelimithitshigh) | warning | api | more than 10 rate-limit hits/s for 5m | No |

---

## 4. Runbook

### Common procedures

Each entry below refers to these. Substitute your own values for the
`<PLACEHOLDERS>`; they are the same ones used in
[`MAINNET_RUNBOOK.md`](./MAINNET_RUNBOOK.md). Never paste the owner secret key
into a ticket or chat.

<a id="pause-the-contract"></a>
**Pause the contract.** Only the contract owner can pause. The owner key is held
by the on-call operator (see the key-handling note in the mainnet runbook).

```bash
# Confirm current state first (public read)
stellar contract invoke --id <CONTRACT_ID> --source <OWNER_SECRET_KEY> \
  --rpc-url "<SOROBAN_RPC_URL>" --network-passphrase "<NETWORK_PASSPHRASE>" \
  -- is_paused

# Pause every state-changing operation
stellar contract invoke --id <CONTRACT_ID> --source <OWNER_SECRET_KEY> \
  --rpc-url "<SOROBAN_RPC_URL>" --network-passphrase "<NETWORK_PASSPHRASE>" \
  -- emergency_pause_all --caller <OWNER_PUBLIC_KEY>
```

`emergency_pause_all` is not timelocked. While paused, the state-changing entry
points (payments, escrows, streams, recurring schedules, batches, hooks) reject
calls with `ContractPaused` (18). Read functions still work. Verify with `is_paused`, which must return
`true`.

To stop one feature only, pause a single scope and leave the rest running:

```bash
stellar contract invoke --id <CONTRACT_ID> --source <OWNER_SECRET_KEY> \
  --rpc-url "<SOROBAN_RPC_URL>" --network-passphrase "<NETWORK_PASSPHRASE>" \
  -- set_scope_paused --caller <OWNER_PUBLIC_KEY> --scope <SCOPE_ID> --paused true
```

Scope ids: `0` Payments, `1` Escrows, `2` Streams, `3` Recurring, `4` Refunds,
`5` Governance, `6` Hooks, `7` Batches. `get_paused_scopes` lists what is paused.

**Resume.** Only after the cause is understood and a second responder agrees:
`emergency_unpause_all --caller <OWNER_PUBLIC_KEY>` (or `set_scope_paused ...
--paused false`), then confirm `is_paused` returns `false`. See
[`CONTRACT_FUNCTION_REFERENCE.md`](./CONTRACT_FUNCTION_REFERENCE.md#emitter-linkage--emergency-controls)
for the full function reference. Do not use `emergency_withdraw` as part of
alert response; it moves funds and needs the escalation path below.

**Check application health.** `curl -s https://<host>/api/health` returns the
database, Redis, Stellar RPC and Horizon status, the contract ID check, and the
`rpcFailover` block. `/api/health/live` is the liveness probe.

<a id="escalate"></a>
**Escalate.** Page in this order and record the alert name, time, and what you
have already done in the incident channel:

1. **Primary on-call engineer.** Acknowledge the page and work the first actions.
2. **Engineering lead, then CTO,** if the alert is critical, the first actions
   have not identified a cause within 30 minutes, or customer payments are
   affected. This is the same chain as the database recovery escalation in
   [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md#73-escalation).
3. **Security** for any suspected loss of funds, unexplained withdrawal, key
   compromise, or accounting invariant violation. Follow [`SECURITY.md`](../SECURITY.md)
   and the contacts in [`MAINTAINERS.md`](../MAINTAINERS.md). Do this in parallel
   with, not after, pausing the contract.
4. Post to the status page (templates in `DISASTER_RECOVERY.md`) once users are
   affected.

Adapt the named roles and channels to your organization's on-call rota. The
repository does not define one.

---

### Contract alerts

These three alerts watch on-chain balances. `ophirpay_contract_balance`,
`ophirpay_locked_balance` and `ophirpay_unlocked_balance` are **not yet exported**
by the application, so they will not fire until an exporter exists. The runbook
entries are still the procedure to follow if you feed those series from
elsewhere or detect the condition by hand.

#### ContractBalanceBelowLocked

- **Meaning:** the contract's token balance is lower than the funds it has
  locked for escrows and streams. Users' funds may be under-collateralized. This
  is either an accounting bug or an unauthorized withdrawal.
- **First actions:**
  1. Treat it as a fund-safety incident. [Pause the contract](#pause-the-contract)
     first, investigate second.
  2. Read `get_locked_balance` and the contract's token balance on-chain and
     confirm the alert is not a stale or mis-scaled metric (amounts are in
     stroops, 1 XLM = 10^7).
  3. Review recent contract transactions and emitted events for withdrawals,
     refunds and `emergency_withdraw` calls.
  4. Preserve evidence: transaction hashes, ledger range, application logs.
- **Pause:** yes, immediately. [Procedure](#pause-the-contract).
- **Escalate:** [immediately](#escalate), including Security. Do not wait for the
  30 minute window.

#### ContractBalanceDroppingFast

- **Meaning:** the balance is falling faster than 10,000,000,000 stroops (1,000
  XLM) per second for 5 minutes. That is either a legitimate mass payout or
  batch, or a drain.
- **First actions:**
  1. Compare with expected activity: scheduled payments, batch runs, a large
     escrow release.
  2. Inspect recent outbound transactions from the contract and check that each
     traces to a known request in the application database.
  3. Check `ContractBalanceBelowLocked`. If it is firing too, follow that entry.
- **Pause:** if you cannot attribute the outflow to legitimate activity within a
  few minutes, [pause](#pause-the-contract). Pause a single scope (payments,
  batches) if the source is clearly limited to one.
- **Escalate:** to Security if the outflow is unexplained; otherwise to the
  engineering lead if it is still unattributed after 30 minutes.

#### LockedBalanceDivergence

- **Meaning:** `balance − locked − unlocked` differs from zero by more than
  10,000,000 stroops (1 XLM) for 5 minutes. The locked-funds accounting no longer
  matches the token balance, which suggests an invariant violation. Tokens sent
  to the contract directly, outside the API, can also cause it.
- **First actions:**
  1. Check for unsolicited direct transfers to the contract address.
  2. Compare `get_locked_balance` with the sum of active escrows and streams in
     the database.
  3. Look for a recent contract upgrade or migration that could have changed
     accounting.
- **Pause:** pause if the divergence is growing or you find no benign cause
  (direct transfer). A stable, explained divergence does not need a pause.
- **Escalate:** to the engineering lead and Security if the divergence is
  unexplained. It is an invariant violation.

### Payment alerts

`ophirpay_batch_failed_items`, `ophirpay_batch_total_items` and
`ophirpay_payment_duration_seconds_bucket` are not exported today (the
application exports `ophirpay_payments_failed_total`, `ophirpay_batches_processed_total`
and the per-endpoint histogram instead), so these two alerts do not fire yet.

#### BatchPaymentFailureRateHigh

- **Meaning:** more than half of batch payment items have failed over 15 minutes,
  sustained for 10. Batches are failing systemically rather than on bad input.
- **First actions:**
  1. Check `/api/health`: is Stellar RPC or Horizon `error`, or is
     `rpcFailover.usingFallback` true?
  2. Check the application logs for the dominant error, and map any contract
     error code with [`CONTRACT_FUNCTION_REFERENCE.md`](./CONTRACT_FUNCTION_REFERENCE.md)
     (`BatchItemFailed` 74, `TokenTransferFailed` 15, `InvalidTokenContract` 80).
  3. Check the token contract and sender balances and trustlines.
  4. See [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) for RPC and trustline errors.
- **Pause:** pause the Batches scope (`--scope 7`) if failures are consuming fees
  or partially executing. A full pause is not needed unless other payment
  scopes are affected.
- **Escalate:** critical. Escalate to the engineering lead if not resolved in
  30 minutes.

#### PaymentProcessingLatencyHigh

- **Meaning:** the 95th percentile payment processing time has exceeded 30
  seconds for 5 minutes. Users see slow or timed-out payments.
- **First actions:**
  1. Check `/api/health` latencies for the database and Stellar RPC.
  2. Check `RpcFailoverDegraded` and `DatabaseQueryLatencyHigh`. They are the
     usual causes.
  3. Check Stellar network congestion and fee levels.
  4. Review outbound timeouts in [`TIMEOUTS.md`](./TIMEOUTS.md).
- **Pause:** normally no. Pause only if slow confirmations are producing duplicate
  or inconsistent submissions.
- **Escalate:** engineering lead if p95 stays above threshold for 30 minutes.

### Webhook alerts

#### WebhookDeliveryFailureRateHigh

- **Meaning:** more than 25% of webhook deliveries ended in a final failure
  (retries exhausted) over 15 minutes, sustained for 10.
- **First actions:**
  1. Split by attempt number:
     `sum by (attempt_number) (rate(ophirpay_delivery_final_outcomes_total{delivery_type="webhook",final_outcome="failure"}[15m]))`.
  2. Determine whether failures are concentrated in a few subscriber endpoints
     (a subscriber outage, not ours) or are across the board (our egress, DNS,
     TLS or SSRF-protection change).
  3. Check webhook worker logs and the `WEBHOOK_TIMEOUT_MS` setting.
  4. See [`webhook-verification.md`](./webhook-verification.md) and
     [`webhook-e2e.md`](./webhook-e2e.md).
- **Pause:** no. Webhook delivery is off-chain. Pause the Hooks scope (`--scope 6`)
  only if on-chain hook registration is itself being abused.
- **Escalate:** engineering lead if it is across the board and unresolved in 30
  minutes. Notify affected subscribers if failures are specific to them.

#### WebhookQueueDepthHigh

- **Meaning:** more than 1000 webhook deliveries have been waiting for 5 minutes.
  Delivery is backed up. `ophirpay_webhook_queue_depth` is **not exported yet**, so
  this alert does not fire today.
- **First actions:**
  1. Confirm the worker or cron that drains deliveries is running and healthy
     (see [`scheduled-payment-cron.md`](./scheduled-payment-cron.md) for the
     scheduled job pattern).
  2. Check for a slow or dead subscriber endpoint blocking the queue.
  3. Check the database and Redis status in `/api/health`.
- **Pause:** no.
- **Escalate:** engineering lead if the queue is still growing after 30 minutes.

### API alerts

#### ApiHighErrorRate

- **Meaning:** more than 5% of API requests are erroring over 5 minutes.
  `ophirpay_http_errors_total` is **not exported yet**; the closest available series
  is `ophirpay_endpoint_errors_total` (with `status_class="5xx"`), so this alert
  does not fire today.
- **First actions:**
  1. Find the failing routes:
     `topk(5, sum by (endpoint) (rate(ophirpay_endpoint_errors_total{status_class="5xx"}[5m])))`.
  2. Check `/api/health` for a failing dependency (database, Redis, RPC).
  3. Check logs by request id and whether it started with a deploy. If it did,
     roll back.
- **Pause:** only if the failing routes are contract-facing and errors are
  producing inconsistent on-chain state.
- **Escalate:** critical. Engineering lead if not mitigated in 30 minutes.

#### ApiDown

- **Meaning:** Prometheus cannot scrape the target labelled `job="ophirpay"`. Either the
  API is down, or the scrape failed authentication (Prometheus counts a `401` as
  down).
- **First actions:**
  1. Test the same credential Prometheus uses:
     `curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $METRICS_TOKEN" https://<host>/api/metrics`.
     - `401`: the API is up and the token is wrong. Compare the token in
       Prometheus's secret with `METRICS_TOKEN` on the app. This usually follows
       a rotation ([`SECRETS_ROTATION.md`](./SECRETS_ROTATION.md)).
     - `200`: the API is up; look at the network path between Prometheus and the
       app (network policy, ingress, TLS).
     - Timeout or `5xx`: the API is down. Continue.
  2. Check `/api/health/live` and the pods (`kubectl get pods`,
     `kubectl logs`). Look for crash loops, OOM kills, a failed rollout.
  3. If the failure began with a deploy, roll it back
     (`helm rollback ophirpay`).
- **Pause:** no. The contract keeps operating without the API. Only pause if the
  outage coincides with a contract alert.
- **Escalate:** critical. Engineering lead if not restored in 15 minutes; status
  page update once users are affected.

#### RateLimitHitsHigh

- **Meaning:** clients are being rate limited at more than 10 requests per second
  for 5 minutes: abuse, a misconfigured client, or a retry storm.
  `ophirpay_rate_limit_hits_total` is **not exported yet**, so this alert does not
  fire today.
- **First actions:**
  1. Identify the client IPs or API keys in the request logs.
  2. Decide between a broken integration (contact the owner, revoke or
     rotate the key) and hostile traffic (block at the edge/WAF).
  3. Check that the limit itself (`RATE_LIMIT_RPM`) is sensible for current load.
- **Pause:** no.
- **Escalate:** Security if the traffic looks like an attack or credential
  guessing.

### Database alerts

Neither `ophirpay_db_pool_available` nor a `ophirpay_db_query_duration_seconds_bucket`
histogram is exported (the application exports only the `_sum` and `_count` of the
query summary), so these alerts do not fire today.

#### DatabaseConnectionPoolExhausted

- **Meaning:** fewer than 2 database connections are free for 2 minutes. New
  requests will queue or fail.
- **First actions:**
  1. Check `/api/health` database status and latency.
  2. Look for long-running queries or idle-in-transaction sessions on the
     database, and for a leak introduced by a recent deploy.
  3. Restart the affected pods to release leaked connections while you
     investigate. Scaling out replicas without raising the database connection
     limit makes this worse.
  4. See [`DATABASE_SCHEMA_MIGRATIONS.md`](./DATABASE_SCHEMA_MIGRATIONS.md) if a
     migration is running.
- **Pause:** no.
- **Escalate:** critical. Engineering lead if not recovered in 15 minutes. If the
  database is unrecoverable, follow [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md).

#### DatabaseQueryLatencyHigh

- **Meaning:** p95 database query time has been above 1 second for 5 minutes.
- **First actions:**
  1. Check database CPU, IO and connection count.
  2. Find slow queries (`pg_stat_statements` or the provider's dashboard) and
     check for missing indexes ([`SCHEMA.md`](./SCHEMA.md)).
  3. Check whether a migration, backup (`db-backup.yml`) or batch job overlaps
     with the onset.
- **Pause:** no.
- **Escalate:** engineering lead if p95 is still above 1s after 30 minutes.

### RPC alerts

These two alerts use metrics the application exports today.

#### RpcFailoverDegraded

- **Meaning:** the app has served Soroban RPC traffic from a fallback endpoint
  (not the primary) for more than 2 minutes. `/api/health` reports `degraded` in
  this state.
- **First actions:**
  1. Read `rpcFailover` in `/api/health`: `activeEndpoint`, `primaryEndpoint`,
     `currentFallbackDurationMs`, and `lastFailureReasons`.
  2. Check the primary provider's status page and probe it:
     `curl -s -X POST <PRIMARY_URL> -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`.
  3. Watch whether `ophirpay_rpc_failover_recoveries_total` increments; recovery
     is automatic when the primary is healthy again.
  4. See [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) for RPC connectivity.
- **Pause:** no. The fallback serves traffic. Pause only if the fallback endpoint
  is returning inconsistent ledger data.
- **Escalate:** engineering lead if on a fallback longer than 30 minutes, or if
  the fallback itself is degrading (`PaymentProcessingLatencyHigh`).

#### RpcFailoverFrequent

- **Meaning:** three or more failovers in 30 minutes. The primary endpoint is
  flapping, and each transition risks a request failing mid-flight.
- **First actions:**
  1. Read `lastFailureReasons` in `/api/health` to see whether failures are
     timeouts, rate limits or errors.
  2. Check the primary provider's status and whether your request volume is being
     throttled.
  3. Check outbound timeouts (`SOROBAN_RPC_TIMEOUT_MS`, `RPC_PROBE_TIMEOUT_MS`,
     see [`TIMEOUTS.md`](./TIMEOUTS.md)).
- **Pause:** no.
- **Escalate:** engineering lead if it persists for more than an hour; consider
  changing the primary provider.

---

## Known limitations

### Metrics endpoint exposure

`/api/metrics` exposes process memory, the full route inventory with live
per-route error rates, webhook delivery counters and open SSE connection counts.
That is useful reconnaissance for an attacker and a cheap target for
resource-exhaustion probing.

**Current state of this repository:** the endpoint is authenticated. It requires
`METRICS_TOKEN` or an admin-scope API key and returns `401` with no body
otherwise (issue #699, see [`metrics-endpoints.md`](./metrics-endpoints.md)). The
"public metrics endpoint" limitation therefore applies to:

- **Deployments running a build from before that change.** Such builds serve
  metrics to anyone who can reach the URL. Confirm with the unauthenticated
  `curl` in [section 1](#endpoint-and-credential); anything other than `401` means
  the endpoint is public. Until you upgrade, block `/api/metrics` at the ingress,
  load balancer or WAF and allow only the Prometheus source address.
- **Any configuration that fails open at another layer**, such as a reverse
  proxy that injects a valid `Authorization` header for every client.

Even on a current build, keep these residual limitations in mind:

- **One shared static token.** It is not per-scraper and has no expiry. Rotate it
  on a schedule and after any suspected leak (see
  [`SECRETS_ROTATION.md`](./SECRETS_ROTATION.md)); Prometheus needs the new value
  at the same time or `ApiDown` fires.
- **Not rate limited.** The proxy exempts `/api/metrics` from rate limiting so
  monitoring is never throttled, which also means token guessing is not
  throttled. Restrict the path to Prometheus's network at the edge in addition to
  requiring the token.
- **Serve it over TLS only.** The token travels in a header on every scrape.

### Alerts reference metrics that are not emitted

The alert rules were written against a larger metric set than the application
currently exports. Series that appear in alert expressions but not in
`/api/metrics`:

`ophirpay_contract_balance`, `ophirpay_locked_balance`,
`ophirpay_unlocked_balance`, `ophirpay_batch_failed_items`,
`ophirpay_batch_total_items`, `ophirpay_payment_duration_seconds_bucket`,
`ophirpay_webhook_queue_depth`, `ophirpay_http_errors_total`,
`ophirpay_db_pool_available`, `ophirpay_db_query_duration_seconds_bucket`,
`ophirpay_rate_limit_hits_total`.

Alerts built only on those series load without error and evaluate to no data, so
**they stay silent, not green**. Today only `ApiDown`,
`WebhookDeliveryFailureRateHigh`, `RpcFailoverDegraded` and `RpcFailoverFrequent`
can fire. In particular there is currently **no automated alert for contract
balance or accounting problems**; until those metrics are exported, monitor
`get_locked_balance` against the on-chain token balance on a schedule.
The dashboard is not affected: its validator only allows metrics that exist.

### Other

- Metrics are in-process, per replica, and reset on every restart or deploy.
  Expect counter resets around rollouts; `rate()` and `increase()` handle them.
- The dashboard's data source UID must be `prometheus` (see
  [section 2](#compatibility)).
