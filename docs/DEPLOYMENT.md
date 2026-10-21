# 🚀 Deployment Guide

> Step-by-step deployment instructions for OphirPay across multiple platforms. Covers Vercel (one-click), Docker, and standalone Node.js — including environment variables, Prisma migrations, Soroban contract deployment, and troubleshooting.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Option 1: Vercel (Recommended)](#option-1-vercel-recommended)
- [Option 2: Docker](#option-2-docker)
- [Option 3: Standalone Node.js](#option-3-standalone-nodejs)
- [Option 4: Kubernetes (Helm)](#option-4-kubernetes-helm)
- [Cache Headers for Static Assets and APIs](#cache-headers-for-static-assets-and-apis)
- [Soroban Contract Deployment](#soroban-contract-deployment)
- [Database Setup](#database-setup)
- [Post-Deployment Verification](#post-deployment-verification)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | 20+ recommended |
| PostgreSQL | 14+ | Neon, Supabase, RDS, or self-hosted |
| Stellar wallet | — | Freighter for testnet, hardware wallet for mainnet |
| Docker | 24+ | Only for Docker deployment |
| Helm | 3+ | Only for Kubernetes deployment |

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

### Required

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/ophirpay` |
| `DATABASE_PROVIDER` | Database provider | `postgresql` |
| `NEXT_PUBLIC_STELLAR_NETWORK` | Stellar network | `TESTNET` or `PUBLIC` |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org:443` |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | Horizon API endpoint | `https://horizon-testnet.stellar.org` |
| `STELLAR_NETWORK_PASSPHRASE` | Network passphrase | `Test SDF Network ; September 2015` |
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed OphirPay contract ID | `CCQGGU...` |
| `NEXT_PUBLIC_EMITTER_CONTRACT_ID` | Deployed emitter contract ID | `CDAVU2...` |
| `NEXT_PUBLIC_APP_URL` | App base URL | `https://ophirpay.vercel.app` |

### Production Required

| Variable | Description | How to generate |
|---|---|---|
| `AUTH_SECRET` | Session signing secret | `openssl rand -hex 32` |

### Optional

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `production` for live deploys |
| `DIRECT_DATABASE_URL` | — | Direct DB URL for Prisma migrations (when using connection pooling) |
| `RATE_LIMIT_RPM` | `120` | Requests per minute per IP (global proxy limit) |
| `AUTH_RATE_LIMIT_IP_RPM` | `30` | Wallet-auth per-IP requests per minute (`/api/auth/challenge`, `/api/auth/session`) |
| `AUTH_RATE_LIMIT_WALLET_RPM` | `10` | Wallet-auth per-account requests per minute (keyed by Stellar public key) |
| `REDIS_URL` | — | Distributed rate limiting. `redis://` = ioredis (Node only); `https://` = Upstash-compatible REST and the only form that shares the *global edge* limit across replicas |
| `NEXT_PUBLIC_SENTRY_DSN` | — | Optional Sentry DSN for client and server error reporting |
| `NEXT_PUBLIC_DEMO_MODE` | `false` | Enable demo mode |
| `NEXT_PUBLIC_FEATURE_MULTI_ASSET` | `false` | Enable multi-asset support |
| `NEXT_PUBLIC_FEATURE_WEBHOOKS` | `false` | Enable webhook features |
| `CRON_SECRET` | — | Shared secret protecting `/api/cron`. Required to run the scheduled-payment cron — see [Scheduled Payment Cron](scheduled-payment-cron.md) |
| `SCHEDULED_PAYMENTS_SOURCE_SECRET` | — | Stellar secret key of the funded operator account that signs due scheduled payments |

### Transactional Email

Required for `src/lib/email.ts` to deliver payment and webhook notification
emails (Resend is called over its HTTPS API — no SMTP, no extra dependency).

| Variable | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | To send email | Resend API key from <https://resend.com/api-keys>. Without it `sendEmail()` throws `EmailConfigurationError` instead of silently dropping the message, and startup logs that email is not configured |
| `EMAIL_FROM` | No | Sender identity, e.g. `OphirPay <payments@ophirpay.com>`. Must be a verified Resend domain. Defaults to `OphirPay <payments@ophirpay.com>` |

### Testnet vs Mainnet

| Setting | Testnet (default) | Mainnet |
|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | `TESTNET` | `PUBLIC` |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org:443` | `https://soroban.stellar.org:443` |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |

---

## Option 1: Vercel (Recommended)

Vercel is the easiest way to deploy OphirPay. The project includes a pre-configured `vercel.json`.

### One-Click Deploy

1. **Fork** the repository to your GitHub account
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your forked repository
4. Vercel auto-detects Next.js — no configuration needed
5. Add environment variables in the Vercel dashboard (see [Environment Variables](#environment-variables))
6. Click **Deploy**

### GitHub Integration

Once connected, every push to `main` auto-deploys:

```
Push to main → Vercel builds → Preview/Production URL
```

- **Production**: Deploys from `main` branch
- **Preview**: Deploys from feature branches (PR comments include the preview URL)

### Vercel-Specific Notes

> `vercel.json` deliberately declares **no** headers. The app layer
> (`next.config.ts`) owns them all, so Vercel and self-hosted deployments
> cannot drift apart — see [Cache Headers for Static Assets and APIs](#cache-headers-for-static-assets-and-apis).

- `output: "standalone"` is **disabled** on Vercel (detected via `process.env.VERCEL`) — Vercel uses its own runtime
- `npx prisma generate` runs automatically during build (configured in `vercel.json` → `buildCommand`)
- The `installCommand` is `npm ci` for deterministic installs
- Region is set to `iad1` (US East) — change in `vercel.json` if you need a different region
- A cron job runs `/api/cron` every 5 minutes to execute due scheduled payments (`.github/workflows/scheduled-payments-cron.yml` → GitHub Actions schedule; a Vercel Cron entry would fail deployment on Hobby, which only allows daily schedules). Set `CRON_SECRET` (as both a GitHub Actions secret and a Vercel environment variable) and `SCHEDULED_PAYMENTS_SOURCE_SECRET` or the endpoint returns `503` and does nothing — see [Scheduled Payment Cron](scheduled-payment-cron.md)

### CLI Deploy (Alternative)

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy to production
vercel --prod

# Or deploy a preview
vercel
```

---

## Option 2: Docker

OphirPay includes a multi-stage `Dockerfile` and a `docker-compose.yml` with PostgreSQL and Redis.

### Quick Start with Docker Compose

```bash
# Clone the repo
git clone https://github.com/OphirPay/OphirPay.git && cd OphirPay

# Start all services (app + PostgreSQL + Redis)
docker compose up -d

# Run database migrations using the dedicated migrator target (#1335)
docker build --target migrator -t ophirpay-migrator .
docker run --rm --network host -e DATABASE_URL="postgresql://ophirpay:ophirpay@localhost:5432/ophirpay" ophirpay-migrator

# Verify
curl http://localhost:3000/api/health
```

### Docker Compose Services

| Service | Image | Port | Purpose |
|---|---|---|---|
| `app` | Built from `Dockerfile` | 3000 | OphirPay application |
| `db` | `postgres:16-alpine` | 5432 | PostgreSQL database |
| `redis` | `redis:7-alpine` | 6379 | Rate limiting cache |

### Customizing Docker Compose

Override environment variables in `docker-compose.yml`:

```yaml
services:
  app:
    environment:
      - DATABASE_URL=postgresql://ophirpay:ophirpay@db:5432/ophirpay
      - NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC
      - NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban.stellar.org:443
      - NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon.stellar.org
      - STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
      - NEXT_PUBLIC_CONTRACT_ID=<your-mainnet-contract-id>
      - NEXT_PUBLIC_EMITTER_CONTRACT_ID=<your-mainnet-emitter-id>
      - NEXT_PUBLIC_APP_URL=https://ophirpay.com
      - AUTH_SECRET=<your-auth-secret>
      - NODE_ENV=production
```

### Local Development with Hot Reload (`docker-compose.dev.yml`)

For local development with live code editing and hot reload (`next dev`), use `docker-compose.dev.yml`:

```bash
docker compose -f docker-compose.dev.yml up
```

This mounts your local repository files, sets `NODE_ENV=development`, and runs `npm run dev` alongside PostgreSQL and Redis services.

### Docker Build Only (Without Compose)

```bash
# Build the image
docker build -t ophirpay .

# Run with environment variables
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e NEXT_PUBLIC_STELLAR_NETWORK=TESTNET \
  -e NEXT_PUBLIC_STELLAR_RPC_URL="https://soroban-testnet.stellar.org:443" \
  -e NEXT_PUBLIC_STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org" \
  -e STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
  -e NEXT_PUBLIC_CONTRACT_ID="CCQGGU..." \
  -e NEXT_PUBLIC_EMITTER_CONTRACT_ID="CDAVU2..." \
  -e NEXT_PUBLIC_APP_URL="http://localhost:3000" \
  ophirpay
```

### Docker Image Details

The `Dockerfile` uses a 4-stage build:

| Stage | Base Image | Purpose |
|---|---|---|
| `deps` | `node:24-slim` | Install npm dependencies (with OpenSSL for Prisma) |
| `builder` | `node:24-slim` | Generate Prisma client, run `next build` |
| `migrator` | `node:24-slim` | Dedicated one-shot Prisma migration image (`npx prisma migrate deploy`, used by Docker & Helm pre-upgrade hooks) |
| `runner` | `node:24-slim` | Minimal production image, runs as the non-root `node` user |

**Key details:**
- Uses **Debian (glibc)**, not Alpine (musl) — Tailwind v4's native binaries require glibc
- Puppeteer download is skipped (`PUPPETEER_SKIP_DOWNLOAD=true`) — not needed for production
- Final image runs as **non-root** user for security
- Standalone output is used (configured in `next.config.ts`)
- The runner stage declares a `HEALTHCHECK` (issue #738) — see below
- **The runner stage does NOT copy the full `node_modules` from the builder** (issue #737).
  Next's `output: "standalone"` creates `.next/standalone/node_modules/` with a pruned set of
  only the runtime dependencies the server actually needs. Copying the full builder
  `node_modules` on top would double the image size and ship every devDependency
  (TypeScript, Prisma CLI, Tailwind, Playwright, Puppeteer) into the distroless layer —
  defeating the purpose of standalone output.  The runner stage only copies the native
  Prisma query-engine binary, which the standalone tracer intentionally omits because it
  is platform-specific.

### Multi-architecture images (linux/amd64 + linux/arm64)

The published image is a **multi-arch manifest**: one tag (`ghcr.io/ophirpay/ophirpay:<tag>`)
whose index lists a `linux/amd64` and a `linux/arm64` image. Docker, Compose and
Kubernetes resolve the matching architecture automatically, so Apple Silicon
laptops (M1–M4) and ARM cloud hosts (AWS Graviton, Oracle Ampere) run the image
**natively** instead of under emulation.

```bash
# Inspect the available platforms for a published tag
docker buildx imagetools inspect ghcr.io/ophirpay/ophirpay:main

# Build both platforms locally and keep them in the build cache
docker buildx create --use --name ophirpay-multi
docker buildx build --platform linux/amd64,linux/arm64 -t ophirpay:local .

# Build only your own architecture (fast path for day-to-day work)
docker buildx build --platform linux/arm64 --load -t ophirpay:local .
```

CI is `.github/workflows/docker-multiarch.yml`:

1. **`build-arch`** (matrix `linux/amd64`, `linux/arm64`) builds each platform with
   `docker buildx --load` and boots the container, requiring both
   `GET /api/health/live` → `200` **and** the image's own `HEALTHCHECK` to report
   `healthy`. On the amd64 runner the arm64 leg runs through QEMU, so this is a real
   arm64 boot test, not just a successful compile.
2. **`publish-manifest`** (push to `main` / `integration/staging` only) rebuilds both
   platforms from the same BuildKit cache scopes and pushes a single tag whose
   manifest lists both architectures, then asserts with
   `docker buildx imagetools inspect` that both are present.

**Why the image is architecture-agnostic without extra work.** The Prisma client is
regenerated inside the `builder` stage, and `docker buildx build --platform X` runs
every stage *for platform X* (under QEMU when X is not the host). The native Prisma
query engine copied into `runner` is therefore always the engine for the target
architecture. `docker-compose.yml` deliberately contains **no** `platform:`
key, so `docker compose up` picks the host architecture from the manifest; adding
one would pin every developer and deployment host to a single architecture.

**Build-time cost (documented and justified).** Both workflow jobs are cached with
`type=gha` BuildKit cache (one scope per architecture) and only run when
`Dockerfile`, dependency, Next config or Prisma files change:

| Leg | Expected run time | Notes |
|---|---|---|
| `linux/amd64` | baseline (unchanged) | Native on GitHub's amd64 runners |
| `linux/arm64` | **≈2–3× the amd64 leg** | Every build stage and the container boot run under QEMU emulation |
| Full CI wall-clock | **≈ +5–8 minutes** on a cold cache, ≈ +0–1 minute warm | `build` and `publish` share cache scopes |

The figures above are the expectation driving the design (QEMU's typical 2–3×
penalty for a Next.js build); the authoritative numbers are the job durations in
the Actions run summary, which is why each run writes its per-architecture
result there.

The increase buys correctness that cannot be bought more cheaply: without an
arm64 image, every Apple Silicon developer and every Graviton/Ampere deployment
pays a much larger penalty at *their* run time (emulated builds, slower-than-native
containers, subtle `exec format error` failures), and none of them find out until
they try it. QEMU is the only option without ARM hardware; the natural follow-up
is to move the arm64 leg to a native `ubuntu-24.04-arm` runner, which removes the
emulation cost entirely while keeping the same manifest output.

### Liveness vs readiness

OphirPay exposes two probes with deliberately different meanings. They are
**not** interchangeable: wiring the dependency-aware check to a liveness probe
lets a transient Postgres/Soroban/Redis outage restart-loop a perfectly healthy
container.

| Probe | Endpoint | Checks | Failure meaning |
|---|---|---|---|
| **Liveness** | `GET /api/health/live` | Process is up and serving HTTP. No database, RPC, Horizon or Redis I/O | The process is wedged — restarting it is the right response |
| **Readiness** | `GET /api/health` | Database (`SELECT 1`, critical, 503 when down), Soroban RPC + Horizon reachability, Redis ping when `REDIS_URL` is set, and the configured contract ID | A dependency is unavailable — stop routing traffic, do **not** restart |

Both paths are exempt from the global rate limiter (`src/proxy.ts`) so
orchestrators can poll them even while the app is under load.

**Docker / Docker Compose.** The image ships a `HEALTHCHECK` that probes the
liveness endpoint with the bundled `node` (the runner image has neither a shell
nor `curl`/`wget`, so a `node -e 'fetch(...)'` exec-form check is the only
portable client):

```bash
docker compose up -d
docker inspect --format '{{.State.Health.Status}}' ophirpay-app-1   # healthy
docker inspect --format '{{json .State.Health}}' ophirpay-app-1 | jq .
```

The healthcheck uses `--interval=30s --timeout=5s --start-period=20s
--retries=3`, and `docker-compose.yml` restates the same timings next to the
`db`/`redis` healthchecks so they are easy to tune together.

**Kubernetes / Helm.** The same split is wired in `k8s/deployment.yaml` and
`helm/ophirpay/values.yaml`:

```yaml
livenessProbe:                     # process only — never restarts on a DB blip
  httpGet:
    path: /api/health/live
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 15
  timeoutSeconds: 5
  failureThreshold: 3
readinessProbe:                    # dependency-aware — drains traffic on 503
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 2
```

---

## Option 3: Standalone Node.js

For deploying to a VPS, bare metal, or any Linux server without Docker.

### Build & Run

```bash
# Clone and install
git clone https://github.com/OphirPay/OphirPay.git && cd OphirPay
npm ci

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate deploy

# Build for production
npm run build

# Start the server
npm start
```

The app runs on `http://localhost:3000` by default.

### Process Manager (PM2)

For production, use PM2 to keep the process alive:

```bash
# Install PM2
npm i -g pm2

# Start OphirPay
pm2 start npm --name "ophirpay" -- start

# Save PM2 config
pm2 save

# Auto-start on boot
pm2 startup
```

### systemd Service

Alternatively, create a systemd service:

```ini
# /etc/systemd/system/ophirpay.service
[Unit]
Description=OphirPay Payment Platform
After=network.target postgresql.service

[Service]
Type=simple
User=ophirpay
WorkingDirectory=/opt/OphirPay
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/OphirPay/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable ophirpay
sudo systemctl start ophirpay
```

### Reverse Proxy (Nginx)

```nginx
# /etc/nginx/sites-available/ophirpay
server {
    listen 80;
    server_name ophirpay.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Option 4: Kubernetes (Helm)

A Helm chart is included in `helm/ophirpay/`. See the detailed
[Kubernetes guide](KUBERNETES.md) for prerequisites, secret provisioning,
build-time `NEXT_PUBLIC_*` behavior, migrations, probes, ingress/TLS, and the
pre-flight validation checklist.

### Deploy with Helm

The chart never renders a Secret out of thin air: either you point it at a
Secret you manage (`secrets.existingSecret`, recommended) or it renders one
from `secrets.*` values, refusing to install when `DATABASE_URL` or
`AUTH_SECRET` is missing.

```bash
kubectl create namespace ophirpay

# Option A (recommended) — the Secret is owned outside the release, so no
# credential ever lands in a values file or in the Helm release metadata.
kubectl create secret generic ophirpay-secrets \
  --namespace ophirpay \
  --from-literal=DATABASE_URL="postgresql://..." \
  --from-literal=AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=NEXT_PUBLIC_CONTRACT_ID="<contract-id>" \
  --from-literal=NEXT_PUBLIC_EMITTER_CONTRACT_ID="<emitter-id>"

helm upgrade --install ophirpay ./helm/ophirpay \
  --namespace ophirpay \
  --set secrets.existingSecret=ophirpay-secrets \
  --set image.tag=1.0.0 \
  --set ingress.hosts[0].host=ophirpay.com \
  --set config.NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC \
  --set config.NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon.stellar.org \
  --set config.NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban.stellar.org:443 \
  --set config.DATABASE_PROVIDER=postgresql \
  --set config.NODE_ENV=production \
  --wait
```

Option B renders the Secret from values instead. `DATABASE_URL` and
`AUTH_SECRET` are required in that mode — rendering fails with a message that
names the missing value instead of starting a pod with an empty environment:

```bash
helm upgrade --install ophirpay ./helm/ophirpay \
  --namespace ophirpay \
  --set image.tag=1.0.0 \
  --set-file secrets.DATABASE_URL=/path/to/database-url \
  --set secrets.AUTH_SECRET="$(openssl rand -hex 32)" \
  --set secrets.NEXT_PUBLIC_CONTRACT_ID="<contract-id>" \
  --set secrets.NEXT_PUBLIC_EMITTER_CONTRACT_ID="<emitter-id>" \
  --wait
```

#### Secret management (issue #1334)

`secrets.existingSecret` names a Secret that already exists in the release
namespace. When it is set the chart renders **no** Secret object and the
Deployment reads the named one, which is what makes the following patterns
first-class instead of unsupported:

- **External Secrets Operator** — sync from AWS Secrets Manager, GCP Secret
  Manager, Vault, or 1Password and let the operator own the object:

  ```yaml
  apiVersion: external-secrets.io/v1beta1
  kind: ExternalSecret
  metadata:
    name: ophirpay-secrets
    namespace: ophirpay
  spec:
    refreshInterval: 1h
    secretStoreRef:
      name: ophirpay-secret-store
      kind: SecretStore
    target:
      name: ophirpay-secrets
    data:
      - secretKey: DATABASE_URL
        remoteRef: { key: ophirpay/database-url }
      - secretKey: AUTH_SECRET
        remoteRef: { key: ophirpay/auth-secret }
      - secretKey: NEXT_PUBLIC_CONTRACT_ID
        remoteRef: { key: ophirpay/contract-id }
      - secretKey: NEXT_PUBLIC_EMITTER_CONTRACT_ID
        remoteRef: { key: ophirpay/emitter-contract-id }
  ```

  ```bash
  helm upgrade --install ophirpay ./helm/ophirpay \
    --namespace ophirpay \
    --set secrets.existingSecret=ophirpay-secrets
  ```

- **Sealed Secrets** — commit an encrypted `SealedSecret`, let the controller
  decrypt it into the `ophirpay-secrets` Secret `existingSecret` names:

  ```bash
  kubeseal --format yaml --namespace ophirpay \
    --name ophirpay-secrets \
    --from-file=DATABASE_URL --from-file=AUTH_SECRET \
    > k8s/sealed-ophirpay-secrets.yaml
  kubectl apply -f k8s/sealed-ophirpay-secrets.yaml
  ```

  Rotating a value means re-sealing the `SealedSecret`; the controller then
  updates the Secret. The chart's `checksum/config` annotation only covers
  values it renders itself, so restart the pods yourself if a rotated secret
  must be picked up immediately:

  ```bash
  kubectl -n ophirpay rollout restart deployment \
    -l app.kubernetes.io/instance=ophirpay
  ```

Do not commit populated `values.yaml`, and do not use `--set
secrets.DATABASE_URL=...` in CI logs; prefer `--set-file` or `existingSecret`.

#### Immutable image references (issue #1333)

`image.tag` defaults to an empty string, which makes the chart render
`Chart.appVersion` (`1.0.0`) instead of the mutable `latest` tag, and
`image.pullPolicy` defaults to `IfNotPresent`. That guarantees two pods of one
release run the same build and that `helm rollback` actually restores the
previous code.

Pin by tag…

```bash
helm upgrade ophirpay ./helm/ophirpay --set image.tag=1.4.2
```

…or, stronger, by digest. A digest cannot be re-pushed under the same name, so
the running build can never change without a new values file:

```bash
DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' \
  ghcr.io/ophirpay/ophirpay:1.4.2)
helm upgrade ophirpay ./helm/ophirpay --set image.digest="${DIGEST#*@}"
```

`image.digest` must be `sha256:` followed by 64 hex characters; anything else
fails the render instead of producing an unpullable reference.

#### Rollouts and autoscaling (issues #1331 and #1332)

- The pod template carries a `checksum/config` annotation over the rendered
  `templates/config.yaml`. Changing any `config.*` or `secrets.*` value produces
  a new pod template, so `helm upgrade` performs a rolling update (maxSurge 1,
  maxUnavailable 0) and the containers pick up the new environment. Without it a
  `helm upgrade` updated the ConfigMap but left the old environment in every
  running container.
- While `autoscaling.enabled` is true (the default) the Deployment renders **no**
  `spec.replicas`: the HorizontalPodAutoscaler owns the replica count, so a
  `helm upgrade` can no longer reset it to `replicaCount` and drop pods under
  load. Set `autoscaling.enabled=false` to manage `replicaCount` by hand.

> ⚠️ **`NEXT_PUBLIC_*` values are baked in at build time.** Next.js inlines them
> into the JavaScript bundles during `next build`, so `config.NEXT_PUBLIC_*`
> entries describe what the running image was built with — they cannot retarget
> a prebuilt image. To switch networks, build your own image with those
> variables supplied as build arguments and point the release at it via
> `--set image.repository` / `--set image.tag`. `helm upgrade` prints the same
> reminder through `helm/ophirpay/templates/NOTES.txt`.
>
> Non-`NEXT_PUBLIC_` variables (for example `STELLAR_NETWORK_PASSPHRASE`) *are*
> read from the environment at runtime and may be set with
> `--set config.STELLAR_NETWORK_PASSPHRASE=...`.
>
> Every key in `helm/ophirpay/values.yaml` must be a variable documented in
> `.env.example`; `src/__tests__/helm-config.test.ts` fails the build otherwise.

### Verify

```bash
kubectl get pods -n ophirpay
kubectl get ingress -n ophirpay
curl https://ophirpay.com/api/health
```

---

## Cache Headers for Static Assets and APIs

`next.config.ts` is the **single source of truth** for the static headers the
app emits, including `Cache-Control`. Every target — Vercel, Docker, Helm and
standalone Node — therefore serves identical headers. Do not re-declare these
headers in `vercel.json`; `src/__tests__/security-headers.test.ts` fails the
build if the two layers disagree (issues #681 and #740).

| Path | `Cache-Control` | Why |
|---|---|---|
| `/_next/static/(.*)` | `public, max-age=31536000, immutable` | Build output is content-addressed: the filename changes when the bytes change, so a 1-year immutable TTL never serves stale code. |
| `/_next/image` | `public, max-age=3600, stale-while-revalidate=86400` | The optimiser URL is stable but the underlying image can change, so it gets a short TTL plus a background revalidation window instead of a year. |
| `/api/(.*)` | `no-cache, no-store, must-revalidate` | Never let a browser or intermediary replay financial data. |
| everything else | *(none set)* | Next's defaults apply. |

All of the above are in addition to the security header set declared on the
`/(.*)` rule (`X-Content-Type-Options`, `X-Frame-Options`,
`X-XSS-Protection: 0`, `Referrer-Policy`, `Permissions-Policy`,
`Strict-Transport-Security`, `Cross-Origin-Opener-Policy`,
`Cross-Origin-Resource-Policy`), which matches asset and API requests too.

### Verify after deploying

```bash
# Hashed chunk → long-lived immutable
curl -sI https://ophirpay.com/_next/static/chunks/main-app-abc123.js \
  | grep -i cache-control
# expect: cache-control: public, max-age=31536000, immutable

# API → never cached
curl -sI https://ophirpay.com/api/stats | grep -i cache-control
# expect: cache-control: no-cache, no-store, must-revalidate

# Security headers still present on an asset response
curl -sI https://ophirpay.com/_next/static/chunks/main-app-abc123.js \
  | grep -i 'x-content-type-options\|strict-transport-security'
```

> Self-hosted reverse proxies (nginx, Cloudflare, an ingress controller) must
> not override these values. If you terminate TLS in front of the app, forward
> the origin's `Cache-Control` untouched rather than setting your own.

---

## Soroban Contract Deployment

OphirPay requires two Soroban contracts. Deploy them before starting the app.

### Testnet (Default)

The testnet contracts are pre-deployed and configured in `.env.example`:

| Contract | ID |
|---|---|
| OphirPay | `CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET` |
| Emitter | `CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN` |

No action needed — just use the defaults.

### Custom Testnet / Mainnet Deployment

```bash
# 1. Build both contracts
cd contracts/ophirpay && cargo build --target wasm32v1-none --release
cd ../emitter && cargo build --target wasm32v1-none --release

# 2. Deploy emitter
stellar contract deploy \
  --wasm target/wasm32v1-none/release/ophirpay_emitter.wasm \
  --source-account <SECRET_KEY> \
  --rpc-url "https://soroban-testnet.stellar.org:443" \
  --network-passphrase "Test SDF Network ; September 2015"
# Save the returned contract ID

# 3. Init emitter
stellar contract invoke --id <EMITTER_ID> --source-account <SECRET_KEY> \
  --rpc-url "https://soroban-testnet.stellar.org:443" \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- init --owner <OWNER_PUBLIC_KEY>

# 4. Deploy main contract
stellar contract deploy \
  --wasm ../ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm \
  --source-account <SECRET_KEY> \
  --rpc-url "https://soroban-testnet.stellar.org:443" \
  --network-passphrase "Test SDF Network ; September 2015"

# 5. Init main contract + point at emitter
stellar contract invoke --id <OPHIRPAY_ID> --source-account <SECRET_KEY> \
  --rpc-url "https://soroban-testnet.stellar.org:443" \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- init --owner <OWNER_PUBLIC_KEY>

stellar contract invoke --id <OPHIRPAY_ID> --source-account <SECRET_KEY> \
  --rpc-url "https://soroban-testnet.stellar.org:443" \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- set_emitter --emitter <EMITTER_ID>
```

Or use the automated script:

```bash
./scripts/deploy-workflow.sh <SECRET_KEY> <OWNER_PUBLIC_KEY> <EMITTER_CONTRACT_ID>
```

---

## Database Setup

### PostgreSQL (Production)

```sql
-- Connect to PostgreSQL and create the database
CREATE DATABASE ophirpay;
CREATE USER ophirpay WITH PASSWORD '<secure-password>';
GRANT ALL PRIVILEGES ON DATABASE ophirpay TO ophirpay;
```

Then run migrations:

```bash
DATABASE_URL="postgresql://ophirpay:<password>@<host>:5432/ophirpay" \
  npx prisma migrate deploy
```

### Connection Pooling (Neon, Supabase)

If your `DATABASE_URL` uses a pooled connection (PgBouncer, Neon), Prisma
migrations need the direct connection. In the committed `prisma/schema.prisma`,
`directUrl` is commented out, so `DIRECT_DATABASE_URL` alone does not redirect
Prisma CLI commands. Set `DATABASE_URL` to the direct URL when running
migrations, or configure `directUrl` in the Prisma datasource:

```env
DATABASE_URL=postgresql://user:pass@ep-xxx.pooler.supabase.com:6543/ophirpay
DIRECT_DATABASE_URL=postgresql://user:pass@ep-xxx.supabase.co:5432/ophirpay
```

The example above documents the two connection strings, but the current
datasource only reads `DATABASE_URL`. See the
[Database Provider Compatibility guide](DATABASE_PROVIDERS.md) for details.

### SQLite (Development Only)

```bash
# DATABASE_PROVIDER alone does not switch Prisma's datasource.
# SQLite requires local, uncommitted schema edits first; see:
# docs/LOCAL_DEV.md and docs/DATABASE_PROVIDERS.md
npx prisma db push
```

> ⚠️ SQLite is for local development only. Production must use PostgreSQL.

---

## Post-Deployment Verification

### Stellar wallet discovery (SEP-1)

The application serves a SEP-1 discovery document at
`https://<your-domain>/.well-known/stellar.toml`. It is generated at request
time from the deployment's Stellar network, network passphrase, RPC/Horizon
URLs, and configured OphirPay/emitter contract IDs, so each environment reports
its own deployment metadata. The document also publishes the network-specific
USDC issuer and links to the deployment and security documentation. Verify the
endpoint after deployment and confirm its `NETWORK_PASSPHRASE`,
`OPHIRPAY_CONTRACT_ID`, and `EMITTER_CONTRACT_ID` values match the variables
configured for that deployment.

Run these checks after deploying:

```bash
# 1. SEP-1 discovery document
curl -fsS https://your-domain.com/.well-known/stellar.toml

# 2. Health check
curl -s https://your-domain.com/api/health | jq .

# 3. Check the dashboard loads
curl -s -o /dev/null -w "%{http_code}" https://your-domain.com/
# Expected: 200

# 4. Check API routes
curl -s -o /dev/null -w "%{http_code}" https://your-domain.com/api/health
# Expected: 200

# 5. Verify database connectivity
curl -s https://your-domain.com/api/health | jq .database
# Expected: "connected"
```

### Manual Smoke Test

1. Visit the dashboard — page loads without errors
2. Connect a Freighter wallet — balance displays
3. Send a small test payment (0.01 XLM) — transaction succeeds
4. Check the payment appears in the Payments page
5. Verify the on-chain record: `stellar contract invoke --id <CONTRACT_ID> -- get_payment_count`

---

## Troubleshooting

### Build Failures

| Error | Cause | Fix |
|---|---|---|
| `Prisma generate failed` | Prisma CLI not installed | Run `npx prisma generate` explicitly, or `npm ci` to install devDependencies |
| `ENOENT: no such file or directory, open '.env'` | Missing `.env` file | Copy `.env.example` to `.env.local` |
| `tailwindcss/postcss` crash on musl | Alpine Linux uses musl libc | Use the Debian-based Dockerfile (already configured) or switch to `node:24-slim` |
| `next build` fails with `ENOENT .next/next-server.js.nft.json` | Standalone mode on Vercel | Already handled — `output` is disabled when `VERCEL` env is set |

### Database Errors

| Error | Cause | Fix |
|---|---|---|
| `P1001: Can't reach database server` | Wrong `DATABASE_URL` or DB is down | Verify the connection string, check if the DB server is running |
| `P1003: Database does not exist` | Database not created | Create the database first, then run `npx prisma migrate deploy` |
| `P3009: found incompatible migrations` | Migration history mismatch | Run `npx prisma migrate reset` (dev only) or check migration folders |
| `relation "User" does not exist` | Migrations not applied | Run `npx prisma migrate deploy` |
| `DIRECT_DATABASE_URL` errors | Pooled connection doesn't support migrations | Set `DIRECT_DATABASE_URL` to the direct (non-pooled) connection |

### Stellar / Contract Errors

| Error | Cause | Fix |
|---|---|---|
| `Contract not found` | Wrong contract ID | Verify `NEXT_PUBLIC_CONTRACT_ID` matches a deployed contract |
| `Network passphrase mismatch` | Wrong network config | Ensure `STELLAR_NETWORK_PASSPHRASE` matches `NEXT_PUBLIC_STELLAR_NETWORK` |
| `Horizon timeout` | RPC endpoint down or slow | Check [status.stellar.org](https://status.stellar.org), try a different Horizon URL |
| `Insufficient funds` | Account not funded | Fund via Friendbot (testnet) or send XLM (mainnet) |

### Runtime Errors

| Error | Cause | Fix |
|---|---|---|
| `AUTH_SECRET is not set` | Missing session secret | Generate with `openssl rand -hex 32` and set in env |
| `CSRF_INVALID` | Session expired or cross-origin issue | Clear cookies, ensure `NEXT_PUBLIC_APP_URL` matches your domain |
| `Rate limit exceeded` | Too many requests | Increase `RATE_LIMIT_RPM` or set up Redis for distributed limiting |
| `WebSocket connection failed` | SSE endpoint unreachable | Check if your reverse proxy supports SSE (disable buffering) |

### Docker-Specific

| Error | Cause | Fix |
|---|---|---|
| `Cannot connect to the Docker daemon` | Docker not running | Start Docker Desktop or `sudo systemctl start docker` |
| `port is already allocated` | Port 3000/5432/6379 in use | Change ports in `docker-compose.yml` or stop the conflicting service |
| `db is unhealthy` | PostgreSQL not ready | Wait for healthcheck, or run `docker compose up -d db` first |
| `npm ci` fails in Docker | Lock file missing or outdated | Delete `package-lock.json` and run `npm install` locally, then commit |

### Vercel-Specific

| Error | Cause | Fix |
|---|---|---|
| `Function has timed out` | API route too slow | Check database queries, add indexes, increase timeout in `vercel.json` |
| `BUILD_ERROR: prisma generate` | Build step issue | Ensure `vercel.json` has `"buildCommand": "npx prisma generate && next build"` |
| ` preview expired` | Preview deployment expired | Redeploy by pushing a commit or clicking "Redeploy" in the dashboard |

---

<div align="center">

**[← Back to OphirPay README](../README.md)**

</div>
