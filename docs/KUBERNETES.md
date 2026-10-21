# Kubernetes deployment

OphirPay ships a Helm chart in `helm/ophirpay/`. It is a starting point for
operators, not a supported hosted product. Review the rendered manifests and
adapt storage, ingress, network policy, and secret management to your cluster.

## Prerequisites

- Kubernetes 1.27 or newer, `kubectl`, and Helm 3.
- An ingress controller and (for automatic certificates) cert-manager.
- PostgreSQL reachable from the namespace. Redis is optional unless distributed
  rate limiting is enabled.
- An OphirPay image already built for the target Stellar network.

## Configuration

The chart renders `values.config` into a ConfigMap. Secrets come from one of
two places:

- **`secrets.existingSecret`** (recommended) — the name of a Secret that already
  exists in the namespace. The chart then renders no Secret object at all and
the Deployment reads that name, so External Secrets, Sealed Secrets, Vault, or
  your platform team own the credentials.
- **`values.secrets`** — the chart renders `<release>-<chart>-secrets`. This
  mode fails fast: `helm template`/`helm install` abort with a message naming
  `secrets.DATABASE_URL` or `secrets.AUTH_SECRET` when either is empty, instead
  of starting a pod with an empty environment.

Either way the pods need at least:

| Secret | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Session signing secret |
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed OphirPay contract |
| `NEXT_PUBLIC_EMITTER_CONTRACT_ID` | Deployed emitter contract |

Add `REDIS_URL` when using a shared rate-limit store and any deployment-specific
credentials required by the application. Optional chart values also support
`REDIS_TOKEN`, `METRICS_TOKEN`, `CRON_SECRET`, and
`SCHEDULED_PAYMENTS_SOURCE_SECRET`; unset optional values are omitted from the
Secret. Keep credentials in an external secret manager or a sealed/encrypted
Secret; do not commit populated `values.yaml`.

### Image pinning

`image.tag` defaults to empty, which renders `Chart.appVersion` (`1.0.0`) — the
chart never deploys the mutable `latest` tag — and `image.pullPolicy` defaults to
`IfNotPresent`. For a fully immutable pin set `image.digest` to a
`sha256:<64 hex>` digest; it takes precedence over `image.tag` and an invalid
digest fails the render. The standalone `k8s/deployment.yaml` is pinned to the
same version.

### Rollouts and replicas

- The pod template carries a `checksum/config` annotation over the rendered
  `templates/config.yaml`, so changing any `config.*` or `secrets.*` value rolls
  the pods on `helm upgrade` (RollingUpdate, maxSurge 1 / maxUnavailable 0).
- With `autoscaling.enabled: true` (the default) the Deployment renders no
  `spec.replicas`; the HPA owns the count. Set `autoscaling.enabled: false` to
  manage `replicaCount` by hand.

### Build-time public configuration

`NEXT_PUBLIC_*` values are inlined by Next.js during `next build`. Changing
those keys in the runtime ConfigMap does not change a prebuilt image. Build a
new image with the desired network, RPC, Horizon, contract, and app URL values,
then deploy that immutable tag. Non-public values such as `DATABASE_URL`,
`AUTH_SECRET`, and `STELLAR_NETWORK_PASSPHRASE` are read at runtime.

## Install and migrate

Render before applying anything:

```bash
# Render against the Secret you already own (no secret values needed):
helm lint helm/ophirpay --set secrets.existingSecret=ophirpay-secrets
helm template ophirpay helm/ophirpay \
  --namespace ophirpay \
  --set secrets.existingSecret=ophirpay-secrets \
  --set image.tag='1.0.0' \
  > /tmp/ophirpay-rendered.yaml
kubectl apply --dry-run=server -f /tmp/ophirpay-rendered.yaml
```

Rendering without `secrets.existingSecret` requires the chart-managed values:

```bash
helm template ophirpay helm/ophirpay \
  --namespace ophirpay \
  --set secrets.DATABASE_URL='postgresql://...' \
  --set secrets.AUTH_SECRET="$(openssl rand -hex 32)" \
  --set secrets.NEXT_PUBLIC_CONTRACT_ID='CC...' \
  --set secrets.NEXT_PUBLIC_EMITTER_CONTRACT_ID='CD...' \
  > /tmp/ophirpay-rendered.yaml
```

Create the namespace and deploy the chart only after the render is reviewed:

```bash
kubectl create namespace ophirpay --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install ophirpay helm/ophirpay \
  --namespace ophirpay --create-namespace \
  --set image.repository=ghcr.io/example/ophirpay \
  --set image.tag='2026-09-24' \
  --set secrets.existingSecret=ophirpay-secrets \
  --set migrations.enabled=true \
  --wait
```

The opt-in Helm hook runs `prisma migrate deploy` before install or upgrade,
using a dedicated `-migrator` image and `DATABASE_URL` from the same Secret as
the application. For example, `image.tag=2026-09-24` uses
`2026-09-24-migrator` unless `migrations.image.tag` is explicitly set. The
Docker workflow publishes both image variants for amd64 and arm64. A failed
migration aborts the Helm upgrade and leaves the failed Job available for
inspection; successful hook Jobs are deleted. Leave `migrations.enabled=false`
to preserve manual migration control.

Do not run `prisma migrate dev` in a production cluster.

## Ingress, TLS, and probes

Set `ingress.hosts` and `ingress.tls` to your hostname and certificate Secret.
The default chart expects an nginx ingress class and cert-manager issuer
`letsencrypt-prod`; change the annotation if your cluster uses another issuer.

Probes are configured with tuned timings to accommodate Next.js route compilation and Prisma database connection pool acquisition during cold starts, preventing premature `CrashLoopBackOff` while ensuring failed pods are detected and restarted within 45 seconds of failure:

- **Liveness probe** (`/api/health/live` on port 3000):
  - Validates process responsiveness without external dependency coupling.
  - `initialDelaySeconds: 30`, `periodSeconds: 10`, `timeoutSeconds: 5`, `failureThreshold: 3`.
- **Readiness probe** (`/api/health/ready` on port 3000):
  - Checks PostgreSQL only; slow or unavailable public Stellar and Redis endpoints do not remove an otherwise usable pod from Service routing.
  - `initialDelaySeconds: 15`, `periodSeconds: 10`, `timeoutSeconds: 5`, `failureThreshold: 3`.

## Pre-flight checklist

- [ ] Build and publish an image with the intended `NEXT_PUBLIC_*` values.
- [ ] Populate secrets through the cluster’s secret-management process, and
      point the release at them with `--set secrets.existingSecret=<name>`.
- [ ] Pin the build: an explicit `image.tag` or an immutable `image.digest`.
- [ ] Confirm database migrations and backups are ready.
- [ ] Run `helm lint` and `helm template`; inspect every rendered Secret,
      ConfigMap, probe, ingress, and NetworkPolicy.
- [ ] Run `kubectl apply --dry-run=server` against the target cluster.
- [ ] Confirm ingress DNS/TLS and `/api/health` from inside and outside the
      cluster.
- [ ] Enable `migrations.enabled` and confirm the matching `-migrator` image is published, or run migrations through an approved external process.
- [ ] Record the image tag, chart version, network, and contract IDs used.

See [Deployment](DEPLOYMENT.md) for Docker, Vercel, and standalone Node.js
options, and [MAINNET_RUNBOOK.md](MAINNET_RUNBOOK.md) before using Mainnet.
