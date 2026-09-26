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

The chart renders `values.config` into a ConfigMap and `values.secrets` into a
Secret. The default secret map is intentionally empty, so never deploy the
defaults unchanged. Supply at least:

| Secret | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Session signing secret |
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed OphirPay contract |
| `NEXT_PUBLIC_EMITTER_CONTRACT_ID` | Deployed emitter contract |

Add `REDIS_URL` when using a shared rate-limit store and any deployment-specific
credentials required by the application. Keep secrets in an external secret
manager or a sealed/encrypted Secret; do not commit populated `values.yaml`.

### Build-time public configuration

`NEXT_PUBLIC_*` values are inlined by Next.js during `next build`. Changing
those keys in the runtime ConfigMap does not change a prebuilt image. Build a
new image with the desired network, RPC, Horizon, contract, and app URL values,
then deploy that immutable tag. Non-public values such as `DATABASE_URL`,
`AUTH_SECRET`, and `STELLAR_NETWORK_PASSPHRASE` are read at runtime.

## Install and migrate

Render before applying anything:

```bash
helm lint helm/ophirpay
helm template ophirpay helm/ophirpay \
  --namespace ophirpay \
  --set secrets.DATABASE_URL='postgresql://...' \
  --set secrets.AUTH_SECRET="$(openssl rand -hex 32)" \
  --set secrets.NEXT_PUBLIC_CONTRACT_ID='CC...' \
  --set secrets.NEXT_PUBLIC_EMITTER_CONTRACT_ID='CD...' \
  > /tmp/ophirpay-rendered.yaml
kubectl apply --dry-run=server -f /tmp/ophirpay-rendered.yaml
```

Create the namespace and deploy the chart only after the render is reviewed:

```bash
kubectl create namespace ophirpay --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install ophirpay helm/ophirpay \
  --namespace ophirpay --create-namespace \
  --set image.repository=ghcr.io/example/ophirpay \
  --set image.tag='2026-09-24' \
  --set-file secrets.DATABASE_URL=/path/to/database-url \
  --set secrets.AUTH_SECRET="$(openssl rand -hex 32)" \
  --wait
```

Run migrations as an explicit release step, using the same image and database
Secret as the application. A migration Job is preferred for production because
it is observable and can be retried independently:

```bash
kubectl -n ophirpay create job --from=deployment/ophirpay ophirpay-migrate-$(date +%s)
kubectl -n ophirpay wait --for=condition=complete job/ophirpay-migrate-* --timeout=10m
```

The generated Job must run `npx prisma migrate deploy` as its command; inspect
the rendered command and logs before relying on it. Do not run `prisma migrate
dev` in a production cluster.

## Ingress, TLS, and probes

Set `ingress.hosts` and `ingress.tls` to your hostname and certificate Secret.
The default chart expects an nginx ingress class and cert-manager issuer
`letsencrypt-prod`; change the annotation if your cluster uses another issuer.

Both probes call `/api/health` on port 3000. Liveness restarts a pod that cannot
serve health requests; readiness removes a pod from Service endpoints while it
is starting or unavailable. Tune delays and thresholds for cold starts, but do
not point probes at a database-only endpoint or make liveness depend on a
transient external provider.

## Pre-flight checklist

- [ ] Build and publish an image with the intended `NEXT_PUBLIC_*` values.
- [ ] Populate secrets through the cluster’s secret-management process.
- [ ] Confirm database migrations and backups are ready.
- [ ] Run `helm lint` and `helm template`; inspect every rendered Secret,
      ConfigMap, probe, ingress, and NetworkPolicy.
- [ ] Run `kubectl apply --dry-run=server` against the target cluster.
- [ ] Confirm ingress DNS/TLS and `/api/health` from inside and outside the
      cluster.
- [ ] Run the Prisma migration Job, then verify rollout and logs.
- [ ] Record the image tag, chart version, network, and contract IDs used.

See [Deployment](DEPLOYMENT.md) for Docker, Vercel, and standalone Node.js
options, and [MAINNET_RUNBOOK.md](MAINNET_RUNBOOK.md) before using Mainnet.
