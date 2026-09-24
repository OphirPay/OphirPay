# ☸️ Kubernetes & Helm Deployment Guide

> How to deploy OphirPay on Kubernetes using the bundled Helm chart (`helm/ophirpay/`)
> and the plain manifests in `k8s/`. Covers prerequisites, required and optional
> values, secret provisioning, the database migration step, the build-time
> `NEXT_PUBLIC_*` caveat, ingress and TLS, probe tuning, and a pre-flight checklist.
>
> ⚠️ **Status: starting point, not a supported product.** The chart renders the
> resources OphirPay needs to run, but it is intentionally minimal — review it
> against your cluster's conventions (ingress controller, CNI, secrets management,
> image registry) before using it in production. For the other deployment targets
> see [DEPLOYMENT.md](DEPLOYMENT.md) (Vercel, Docker, standalone Node.js).

---

## Table of Contents

- [1. Prerequisites](#1-prerequisites)
- [2. What the chart deploys](#2-what-the-chart-deploys)
- [3. Required and optional values](#3-required-and-optional-values)
- [4. Provisioning secrets](#4-provisioning-secrets)
- [5. Build-time vs runtime configuration](#5-build-time-vs-runtime-configuration)
- [6. Running database migrations](#6-running-database-migrations)
- [7. Ingress and TLS](#7-ingress-and-tls)
- [8. Probes and the health endpoint](#8-probes-and-the-health-endpoint)
- [9. Deploy and verify](#9-deploy-and-verify)
- [10. Pre-flight checklist](#10-pre-flight-checklist)
- [11. Known caveats](#11-known-caveats)
- [12. Troubleshooting](#12-troubleshooting)
- [13. Related documentation](#13-related-documentation)
- [Appendix: plain manifests (k8s/)](#appendix-plain-manifests-k8s)

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| Kubernetes cluster | 1.25+ (the chart uses GA `apps/v1`, `networking.k8s.io/v1`, `policy/v1`, `autoscaling/v2` APIs) |
| `kubectl` | matching the cluster version |
| Helm | 3.x — verified against the chart with `helm lint` and `helm template` (see §10) |
| Ingress controller | nginx by default (`ingress.className: nginx`); any controller works if you override the class and annotations |
| cert-manager *(optional)* | only needed for the default `cert-manager.io/cluster-issuer` annotation to actually issue certificates |
| metrics-server *(optional)* | required by the HorizontalPodAutoscaler (`autoscaling.enabled: true` by default) |
| Container image | built from this repo and pushed to a registry your cluster can pull from — see §5 for the `NEXT_PUBLIC_*` build values |
| PostgreSQL | reachable from the cluster at the `DATABASE_URL` you provide |

Defaults you must replace before a real deploy:

- `image.repository` / `image.tag` — the default `ghcr.io/ophirpay/ophirpay:latest` is a placeholder, not a published image you can pull.
- `ingress.hosts[0].host` — defaults to `ophirpay.com`.
- Every key in the `secrets` map — empty by default (§4).

---

## 2. What the chart deploys

`helm/ophirpay/templates/` renders:

| Resource | Name | Notes |
|---|---|---|
| Deployment | `<fullname>` | 2 replicas, `RollingUpdate` with `maxUnavailable: 0` |
| ServiceAccount | `<fullname>` | rendered when `serviceAccount.create: true` (default) |
| Service | `<fullname>` | `ClusterIP`, port 80 → container port 3000 |
| Ingress | `<fullname>` | nginx + TLS, when `ingress.enabled: true` (default) |
| ConfigMap | `<fullname>-config` | non-secret env, from the `config` map |
| Secret | `<fullname>-secrets` | `envFrom.secretRef` target, from the `secrets` map |
| HorizontalPodAutoscaler | `<fullname>` | CPU 70% / memory 80%, 2–10 replicas |
| PodDisruptionBudget | `<fullname>` | `minAvailable: 1` |
| NetworkPolicy | `<fullname>` | ingress from `ingress-nginx` only; egress limited to TCP 443/5432 (see §11) |

`<fullname>` is `<release-name>-<chart-name>` (e.g. release `ophirpay` → `ophirpay-ophirpay`). Set `--set fullnameOverride=ophirpay` to get the short names (`ophirpay-config`, `ophirpay-secrets`, …) that match the plain manifests in `k8s/`.

Inspect the inventory before applying:

```bash
helm template ophirpay ./helm/ophirpay --namespace ophirpay | grep -E '^kind:' | sort | uniq -c
```

---

## 3. Required and optional values

### Required values

| Value | Why | Example |
|---|---|---|
| `image.repository`, `image.tag` | the default image reference is a placeholder | `<registry>/ophirpay:v1.0.0` |
| `secrets.DATABASE_URL` | required by the env schema (`src/lib/env.ts`); the app refuses to start without it | `postgresql://user:***@host:5432/ophirpay?sslmode=require` |
| `secrets.NEXT_PUBLIC_CONTRACT_ID` | required — there is no fallback (`src/lib/contracts.ts`); `/api/health` also validates it | deployed OphirPay contract ID (`C…`, 56 chars) |
| `secrets.NEXT_PUBLIC_EMITTER_CONTRACT_ID` | required — there is no fallback | deployed emitter contract ID |
| `secrets.AUTH_SECRET` | required in production (session signing; ≥ 32 chars) | `openssl rand -hex 32` |
| `ingress.hosts[0].host` + matching `ingress.tls[0].hosts` | the default host is `ophirpay.com` | your domain |

### Optional but commonly set values

| Value | Default | Notes |
|---|---|---|
| `secrets.REDIS_URL` | `""` | enables distributed rate limiting; also checked by `/api/health` |
| `secrets.CRON_SECRET` (≥ 16 chars) | `""` | required to run `/api/cron` (scheduled payments) |
| `secrets.SCHEDULED_PAYMENTS_SOURCE_SECRET` | `""` | Stellar secret that signs due scheduled payments |
| `config.*` | `TESTNET` defaults | non-secret runtime env, rendered into the ConfigMap |
| `replicaCount` | `2` | ignored while the HPA is enabled |
| `autoscaling.*`, `pdb.*`, `networkPolicy.enabled` | enabled | see §11 for the NetworkPolicy caveat |
| `resources`, `nodeSelector`, `tolerations`, `affinity` | small defaults | size for your cluster |
| `serviceAccount.annotations` | `{}` | e.g. for IRSA / Workload Identity |
| `imagePullSecrets` | `[]` | for private registries |
| `livenessProbe` / `readinessProbe` | see §8 | plain probe maps — tune per §8 |

### The `config` map (and the key-name rule)

`.Values.config` is rendered verbatim into `<fullname>-config` and injected with `envFrom`. **Keys must match the application's env schema exactly** — unknown keys are silently ignored, which is how a previous `NEXT_PUBLIC_HORIZON_URL` / `NEXT_PUBLIC_SOROBAN_RPC_URL` mismatch shipped: the app reads `NEXT_PUBLIC_STELLAR_HORIZON_URL` / `NEXT_PUBLIC_STELLAR_RPC_URL` (`src/lib/env.ts`), so those values never reached it. The canonical names live in `src/lib/env.ts`; when in doubt, grep it.

Because the ConfigMap is consumed via `envFrom`, **existing pods do not pick up ConfigMap edits** — restart after changing env, and remember §5 for `NEXT_PUBLIC_*`:

```bash
kubectl rollout restart deployment/ophirpay -n ophirpay
```

### Testnet vs mainnet

| Setting | Testnet (default) | Mainnet |
|---|---|---|
| `config.NEXT_PUBLIC_STELLAR_NETWORK` | `TESTNET` | `PUBLIC` |
| `config.NEXT_PUBLIC_STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org:443` | `https://soroban.stellar.org:443` |
| `config.NEXT_PUBLIC_STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| `config.STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |

> ⚠️ `NEXT_PUBLIC_*` entries in this table are **build-time** values, not runtime knobs — read §5 before flipping them in a ConfigMap.

---

## 4. Provisioning secrets

The chart **always renders** `<fullname>-secrets` (Opaque, `stringData`) from `.Values.secrets`, and the Deployment consumes it via `envFrom.secretRef`. All keys default to empty strings, so a fresh install without overrides yields a pod that fails env validation and crash-loops — that is intentional: required values are not guessed.

Recommended provisioning (keeps secrets out of your shell history and out of git):

```yaml
# values.secrets.yaml — keep this file out of git (e.g. .git/info/exclude), chmod 600
secrets:
  DATABASE_URL: "postgresql://user:***@host:5432/ophirpay?sslmode=require"
  AUTH_SECRET: "<openssl rand -hex 32>"
  NEXT_PUBLIC_CONTRACT_ID: "C..."
  NEXT_PUBLIC_EMITTER_CONTRACT_ID: "C..."
  # REDIS_URL: "redis://:password@redis:6379"
```

```bash
helm upgrade --install ophirpay ./helm/ophirpay \
  --namespace ophirpay --create-namespace \
  --set fullnameOverride=ophirpay \
  -f values.secrets.yaml \
  -f values.production.yaml \
  --wait
```

Notes:

- `--set secrets.NAME=value` also works for quick tests — use `--set-string` for values containing commas or URLs. Be aware that **Helm stores the values you pass in the release record** (a base64 Secret in the namespace): anyone with read access plus `helm get values` can see them. Prefer a values file (or external tooling) and namespace-scoped RBAC.
- The chart has **no `existingSecret` support**: it renders its own Secret and overwrites it on every upgrade, so an externally managed Secret with a different name is not consumed. If you use External Secrets Operator / Sealed Secrets / Vault, generate the values file in CI or patch the chart — don't pre-create a Secret expecting the Deployment to use it.
- Verify the keys made it in (values stay hidden):

  ```bash
  kubectl get secret ophirpay-secrets -n ophirpay \
    -o go-template='{{range $k,$v := .data}}{{$k}}{{"\n"}}{{end}}'
  ```

- Rotation and the full secrets inventory: [SECRETS_ROTATION.md](SECRETS_ROTATION.md).

---

## 5. Build-time vs runtime configuration

> ⚠️ **The most important caveat in this guide.** `NEXT_PUBLIC_*` values are
> **inlined into the JavaScript bundles at `next build` time**. Changing them in
> the ConfigMap or Secret at runtime has **no effect** on an image that was
> already built.

How it works in this repo:

- Next.js inlines the `process.env.NEXT_PUBLIC_*` references it knows at `next build` — the names present in the build environment (or loaded from `.env*` files in the build context). **Inlining is per key**: a name that was *not* set at build time is left as a plain `process.env` read in server code, while the browser bundle has no access to the pod's environment at all — so a ConfigMap can never configure a `NEXT_PUBLIC_*` value for the client. `src/lib/stellar.ts` reads `NEXT_PUBLIC_STELLAR_NETWORK`, `NEXT_PUBLIC_STELLAR_RPC_URL` and `NEXT_PUBLIC_STELLAR_HORIZON_URL` at module scope; `src/lib/contracts.ts` reads the contract IDs the same way.
- The bundled `Dockerfile` declares **no `NEXT_PUBLIC_*` build args** — it runs `next build` with whatever is in the build environment (plus `.env*` files present in the build context). Build it without those variables and the image bakes in the compile-time defaults (testnet URLs) regardless of what your ConfigMap says.

Consequences:

1. Treat every `NEXT_PUBLIC_*` value as **part of the image**, not part of the cluster configuration. Pin them per image tag and keep `<fullname>-config` consistent with them so operators can read which network an image targets.
2. **To change networks or endpoints (or contract IDs) you rebuild and redeploy the image** — `kubectl edit configmap` / `helm upgrade --set config.NEXT_PUBLIC_…` will not move the app.
3. Non-`NEXT_PUBLIC_*` variables (`DATABASE_URL`, `AUTH_SECRET`, `STELLAR_NETWORK_PASSPHRASE`, `REDIS_URL`, `CRON_SECRET`, …) are read at runtime and behave like normal Kubernetes config — the ConfigMap/Secret is the right place for them.
4. `NEXT_PUBLIC_APP_URL` is build-time too — set it to your public URL when building, or CSRF checks and cookie origins will reject requests from your ingress host.

To make the build explicit and reproducible, declare the args in the builder stage of your Dockerfile (before `RUN npm run build`):

```dockerfile
ARG NEXT_PUBLIC_STELLAR_NETWORK
ARG NEXT_PUBLIC_STELLAR_RPC_URL
ARG NEXT_PUBLIC_STELLAR_HORIZON_URL
ARG NEXT_PUBLIC_CONTRACT_ID
ARG NEXT_PUBLIC_EMITTER_CONTRACT_ID
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_STELLAR_NETWORK=$NEXT_PUBLIC_STELLAR_NETWORK \
    NEXT_PUBLIC_STELLAR_RPC_URL=$NEXT_PUBLIC_STELLAR_RPC_URL \
    NEXT_PUBLIC_STELLAR_HORIZON_URL=$NEXT_PUBLIC_STELLAR_HORIZON_URL \
    NEXT_PUBLIC_CONTRACT_ID=$NEXT_PUBLIC_CONTRACT_ID \
    NEXT_PUBLIC_EMITTER_CONTRACT_ID=$NEXT_PUBLIC_EMITTER_CONTRACT_ID \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
```

```bash
docker build \
  --build-arg NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC \
  --build-arg NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban.stellar.org:443 \
  --build-arg NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon.stellar.org \
  --build-arg NEXT_PUBLIC_CONTRACT_ID=C... \
  --build-arg NEXT_PUBLIC_EMITTER_CONTRACT_ID=C... \
  --build-arg NEXT_PUBLIC_APP_URL=https://ophirpay.com \
  -t <registry>/ophirpay:v1.0.0 .
```

Sanity check after a build (replace the sentinel with one of your real values): the value should appear inside the compiled server/client bundles, not only in your shell:

```bash
grep -r "horizon.stellar.org" .next/server .next/static | head
```

**Verified against this repo (Next.js 16.3.4):** an image built with sentinel `NEXT_PUBLIC_STELLAR_HORIZON_URL` / `NEXT_PUBLIC_STELLAR_RPC_URL` values and then run with *different* values in its environment still reported the **build-time** URLs from `/api/health`, and the sentinel strings sit in `.next/static` (client bundle) — those names were set at build, so they are frozen everywhere. The compiled output shows the per-key rule directly: the frozen keys became string literals in the server chunk while an unset name stayed a literal `process.env.NEXT_PUBLIC_STELLAR_NETWORK` read — and setting *that* name at runtime did change the reported network (server-side only). Practical rule: **bake every `NEXT_PUBLIC_*` value you rely on at build time**; never depend on the cluster to set one.

---

## 6. Running database migrations

The app expects the schema in `prisma/migrations/` to be applied before the new pods roll out. Production migrations are `prisma migrate deploy` (never `migrate dev`, never `db push`). It is idempotent — safe to re-run before every release. See [DATABASE_SCHEMA_MIGRATIONS.md](DATABASE_SCHEMA_MIGRATIONS.md) for schema and zero-downtime patterns.

**The published image cannot run migrations.** The Dockerfile's `runner` stage copies only `public/`, `node_modules/`, `.next/standalone` and `.next/static` into a distroless base — the `prisma/` directory (schema + migrations) is not in the image, and distroless has no shell, so `kubectl exec … npx prisma migrate deploy` and shell-based init containers do not work against that image. Use one of:

### (a) Run the migration from CI or an operator machine, before the rollout (recommended)

```bash
# from a checkout of this repo, with the production database URL:
DATABASE_URL="postgresql://..." DIRECT_DATABASE_URL="postgresql://..." npx prisma migrate deploy

# then roll out the app:
helm upgrade --install ophirpay ./helm/ophirpay -n ophirpay -f values.secrets.yaml --wait
```

If your `DATABASE_URL` uses a connection pooler (PgBouncer, Neon, Supabase), also set `DIRECT_DATABASE_URL` to the direct connection — the schema declares it, and Prisma Migrate uses it when present.

### (b) Run it in-cluster as a Job, from a purpose-built migration image

Build a small image that carries the Prisma CLI (from the lockfile) plus the migrations:

```dockerfile
# Dockerfile.migrations
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
```

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: ophirpay-migrate
  namespace: ophirpay
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: <registry>/ophirpay-migrations:v1.0.0
          command: ["npx", "prisma", "migrate", "deploy"]
          envFrom:
            - secretRef:
                name: ophirpay-secrets   # adjust to <fullname>-secrets (see §2)
```

Run it as a step before `helm upgrade` (or gate the rollout on it in CI). Ordering rules:

1. Migration first, app second. Keep migrations expand/contract-compatible so the old pods keep working while the job runs.
2. Helm does not roll back database migrations — `helm rollback` restores manifests only. Design migrations so the previous app version tolerates the new schema.

---

## 7. Ingress and TLS

Defaults in `values.yaml`:

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
  hosts:
    - host: ophirpay.com
  tls:
    - secretName: ophirpay-tls
      hosts: [ophirpay.com]
```

- Set the host in **both** `ingress.hosts[0].host` and `ingress.tls[0].hosts[0]` (they must match), or override the whole block with `-f`:

  ```yaml
  # values.ingress.yaml
  ingress:
    hosts:
      - host: pay.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: ophirpay-tls
        hosts:
          - pay.example.com
  ```

- With cert-manager installed and a `letsencrypt-prod` ClusterIssuer, the annotation provisions `ophirpay-tls` automatically. Without cert-manager, remove the annotation and either supply the TLS secret yourself or terminate TLS at your own load balancer — otherwise nginx serves its fallback certificate.
- Using another ingress controller: override `ingress.className` and replace the `nginx.ingress.kubernetes.io/*` annotations.
- SSE streaming (`/api/events`) works through nginx out of the box: the app sends `X-Accel-Buffering: no`, so no extra buffering annotations are required.
- The app already sets HSTS and the other security headers (`next.config.ts`), so don't duplicate them at the ingress.

---

## 8. Probes and the health endpoint

Both probes point at `/api/health` (see `src/app/api/health/route.ts`), which:

1. runs `SELECT 1` against the database;
2. POSTs a `getHealth` JSON-RPC call to the Soroban RPC endpoint (5 s timeout);
3. GETs the Horizon root endpoint (5 s timeout);
4. pings Redis when `REDIS_URL` is set (3 s timeout);
5. validates the contract ID format.

It answers **200** `ok`, **200** `degraded` (only optional components failing) and **503** `error` (database check failed). The checks run sequentially, so a worst case of ≈ 13 s (5 + 5 + 3) plus the DB round-trip is possible before the response is written.

Chart defaults: liveness `initialDelay 30 / period 15 / timeout 5 / failure 3`, readiness `initialDelay 10 / period 10 / timeout 3 / failure 2`.

Tuning guidance:

- Only a **database** outage flips the status to 503 — degraded upstream services still return 200, so probes do not fail on a Stellar-network blip. Good.
- But when the DB is down, the **liveness** probe fails too, so all pods restart in a loop while you fix the database. If you prefer pods to stay put (and just be removed from the Service via readiness), raise `failureThreshold` and/or `periodSeconds` on liveness:

  ```yaml
  livenessProbe:
    httpGet: { path: /api/health, port: 3000 }
    initialDelaySeconds: 30
    periodSeconds: 20
    timeoutSeconds: 10
    failureThreshold: 6
  readinessProbe:
    httpGet: { path: /api/health, port: 3000 }
    initialDelaySeconds: 10
    periodSeconds: 10
    timeoutSeconds: 10
    failureThreshold: 3
  ```

- Keep `timeoutSeconds` ≥ 10 on both probes if you want them to survive a slow Horizon/RPC hop — with the defaults, `timeout 5` (liveness) can fire while the health route is still waiting on its upstreams.
- The route ignores the `service.port` value: probes and the Service target `service.targetPort` (3000). Keep that in mind if you remap ports.
- Rolling updates keep `maxUnavailable: 0`, so at least the available replicas serve traffic while new pods warm up. If you enable SSE traffic at scale, consider raising `terminationGracePeriodSeconds` (not exposed by the chart — set it via a chart patch) so long-lived `/api/events` connections drain gracefully.
- Prometheus scraping is annotated on the pod (`/api/metrics`, port 3000) via `podAnnotations`.

---

## 9. Deploy and verify

```bash
helm upgrade --install ophirpay ./helm/ophirpay \
  --namespace ophirpay --create-namespace \
  --set fullnameOverride=ophirpay \
  --set image.repository=<registry>/ophirpay \
  --set image.tag=v1.0.0 \
  -f values.secrets.yaml \
  -f values.ingress.yaml \
  --wait --timeout 5m

kubectl rollout status deployment/ophirpay -n ophirpay
kubectl get pods,svc,ingress,hpa,pdb -n ophirpay
curl -s https://<host>/api/health | jq .   # expect "status": "ok"
```

Rollback: `helm rollback ophirpay -n ophirpay` re-applies the previous manifests (including the previous image tag). Remember that database migrations are not rolled back (§6).

---

## 10. Pre-flight checklist

Run through this before every production install/upgrade:

- [ ] **Lint the chart**: `helm lint ./helm/ophirpay`
- [ ] **Render and read the manifests before applying** — this is the step that would have caught the config-key mismatch:

  ```bash
  helm template ophirpay ./helm/ophirpay --namespace ophirpay \
    -f values.secrets.yaml --debug > rendered.yaml
  grep -E 'NEXT_PUBLIC_STELLAR_(HORIZON|RPC)_URL' rendered.yaml   # keys the app actually reads
  ```

- [ ] **Schema-validate the rendered output**:

  ```bash
  kubeconform -strict -summary rendered.yaml
  # or without a local install:
  docker run --rm -v "$PWD:/data" ghcr.io/yannh/kubeconform:latest \
    -strict -summary /data/rendered.yaml
  ```

- [ ] **Server-side dry run** (needs the namespace to exist; catches RBAC/immutability issues):

  ```bash
  helm upgrade --install ophirpay ./helm/ophirpay -n ophirpay --dry-run=server \
    --set fullnameOverride=ophirpay -f values.secrets.yaml
  ```

- [ ] Required keys present in the rendered ConfigMap/Secret (`DATABASE_URL`, contract IDs, `AUTH_SECRET` — §3/§4)
- [ ] Image built with the intended `NEXT_PUBLIC_*` values and pullable from the cluster (§5)
- [ ] Database migrated before the rollout (§6)
- [ ] `ingress.hosts[0].host` + TLS hosts match your DNS record; ClusterIssuer exists if you rely on the default cert-manager annotation (§7)
- [ ] metrics-server installed if you keep `autoscaling.enabled: true`, otherwise the HPA reports `<unknown>` (§11)
- [ ] NetworkPolicy egress reviewed — DNS and Redis are **not** allowed by default (§11)
- [ ] Probes reviewed against your latency budget (§8)

---

## 11. Known caveats

- **NetworkPolicy egress is narrow.** The default policy only allows TCP 443 and 5432. With a CNI that enforces egress (Calico, Cilium, …) pods also need **DNS (UDP/TCP 53)** to resolve the Stellar endpoints, and **Redis (6379)** if `REDIS_URL` points at an in-cluster Redis. Until the template is extended, either add the ports to `networkPolicy` in `templates/config.yaml` or disable the policy:

  ```bash
  helm upgrade ... --set networkPolicy.enabled=false
  ```

  ```yaml
  # added to the egress list in helm/ophirpay/templates/config.yaml
  - ports:
      - { protocol: UDP, port: 53 }
      - { protocol: TCP, port: 53 }
  - ports:
      - { protocol: TCP, port: 6379 }   # only if an in-cluster Redis is used
  ```

- **Ingress ingress-rule scope**: traffic is only allowed from the `ingress-nginx` namespace. A controller in another namespace is blocked by the NetworkPolicy.
- **HPA without metrics-server** silently does nothing useful (`kubectl describe hpa` → `unknown` metrics).
- **Secret visibility through Helm**: `helm get values` returns everything passed with `--set`/`-f`, and the release record itself lives in the namespace. Treat namespace access as secret access.
- **`pullPolicy: Always` + mutable tags** makes deployments non-reproducible; pin a tag or digest.
- **No `existingSecret` support** (see §4).
- The chart is a **starting point** — there is no chart test suite or chart CI in this repo; validate locally per §10.

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Pods stuck `Pending`/`0/2`, events show `error looking up service account "<ns>/<name>"` | Deployment references a ServiceAccount that the chart did not render | ensure the chart version renders `templates/serviceaccount.yaml`, or set `--set serviceAccount.create=false` (pods use `default`) |
| `CrashLoopBackOff` right after start, logs mention a missing env var (e.g. `NEXT_PUBLIC_CONTRACT_ID is required`) | `secrets` map left at empty defaults | §4 — provide real values, then upgrade |
| All pods restart when the database is unavailable | liveness probe on `/api/health` returns 503 | raise liveness `failureThreshold`, or accept the restarts (§8) |
| Config change has no effect | env is injected at pod start | `kubectl rollout restart` for runtime vars — and note `NEXT_PUBLIC_*` never changes without a rebuild (§5) |
| App targets the wrong network after editing the ConfigMap | `NEXT_PUBLIC_*` are build-time | rebuild the image with the right build args (§5) |
| `502/504` from the ingress | pods unready / no endpoints | `kubectl describe ingress`, `kubectl get endpoints`, check probe status |
| TLS handshake fails / fallback cert | no cert-manager, or `ingress.tls[0].hosts` mismatch | §7 |
| HPA shows `<unknown>` targets | metrics-server missing | install metrics-server |
| `kubectl exec` fails with "no such file or directory" | distroless image has no shell | use `kubectl debug -it pod/<pod> --image=busybox --target=<container>` |
| `ImagePullBackOff` | placeholder image reference, or missing `imagePullSecrets` | set `image.repository`/`image.tag`, add pull secret |

---

## 13. Related documentation

- [DEPLOYMENT.md](DEPLOYMENT.md) — all deployment targets (Vercel, Docker, Node.js) with the shared env reference
- [MAINNET_RUNBOOK.md](MAINNET_RUNBOOK.md) — mainnet launch checklist (includes the Helm step)
- [deployment-mainnet.md](deployment-mainnet.md) — mainnet environment configuration
- [DATABASE_SCHEMA_MIGRATIONS.md](DATABASE_SCHEMA_MIGRATIONS.md) — schema guide and zero-downtime migration patterns
- [SECRETS_ROTATION.md](SECRETS_ROTATION.md) — secrets inventory and rotation procedures
- [metrics-endpoints.md](metrics-endpoints.md) — the metrics behind the Prometheus pod annotations
- [LOCAL_DEV.md](LOCAL_DEV.md) — local development setup

---

## Appendix: plain manifests (k8s/)

`k8s/` contains a chart-free path for small installs: `k8s/namespace-config.yaml` (Namespace, ConfigMap, Secret with `CHANGE_ME` placeholders) and `k8s/deployment.yaml` (Deployment, Service, Ingress, HPA, PDB, NetworkPolicy — no ServiceAccount, pods use `default`).

```bash
# 1. replace CHANGE_ME / *** placeholders and the placeholder image first
kubectl apply -f k8s/namespace-config.yaml
kubectl apply -f k8s/deployment.yaml
```

The env keys are identical to the chart's (see §3) and the same `NEXT_PUBLIC_*` build-time rule applies (§5). The manifests are kept in sync with the chart's defaults by hand — prefer the Helm chart unless you specifically want raw YAML.
