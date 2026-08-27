# 🚀 Deployment Guide

> Step-by-step deployment instructions for OphirPay across multiple platforms. Covers Vercel (one-click), Docker, and standalone Node.js — including environment variables, Prisma migrations, Soroban contract deployment, and troubleshooting.

---

## Table of Contents

- [Prerequisites](#-prerequisites)
- [Environment Variables](#-environment-variables)
- [Option 1: Vercel (Recommended)](#-option-1-vercel-recommended)
- [Option 2: Docker](#-option-2-docker)
- [Option 3: Standalone Node.js](#-option-3-standalone-nodejs)
- [Option 4: Kubernetes (Helm)](#-option-4-kubernetes-helm)
- [Soroban Contract Deployment](#-soroban-contract-deployment)
- [Database Setup](#-database-setup)
- [Post-Deployment Verification](#-post-deployment-verification)
- [Troubleshooting](#-troubleshooting)

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
| `RATE_LIMIT_RPM` | `120` | Requests per minute per IP |
| `REDIS_URL` | — | Redis URL for distributed rate limiting |
| `NEXT_PUBLIC_SENTRY_DSN` | — | Sentry error tracking DSN |
| `NEXT_PUBLIC_DEMO_MODE` | `false` | Enable demo mode |
| `NEXT_PUBLIC_FEATURE_MULTI_ASSET` | `false` | Enable multi-asset support |
| `NEXT_PUBLIC_FEATURE_WEBHOOKS` | `false` | Enable webhook features |

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
5. Add environment variables in the Vercel dashboard (see [Environment Variables](#-environment-variables))
6. Click **Deploy**

### GitHub Integration

Once connected, every push to `main` auto-deploys:

```
Push to main → Vercel builds → Preview/Production URL
```

- **Production**: Deploys from `main` branch
- **Preview**: Deploys from feature branches (PR comments include the preview URL)

### Vercel-Specific Notes

- `output: "standalone"` is **disabled** on Vercel (detected via `process.env.VERCEL`) — Vercel uses its own runtime
- `npx prisma generate` runs automatically during build (configured in `vercel.json` → `buildCommand`)
- The `installCommand` is `npm ci` for deterministic installs
- Region is set to `iad1` (US East) — change in `vercel.json` if you need a different region

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

# Run database migrations
docker compose exec app npx prisma migrate deploy

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

The `Dockerfile` uses a 3-stage build:

| Stage | Base Image | Purpose |
|---|---|---|
| `deps` | `node:24-slim` | Install npm dependencies (with OpenSSL for Prisma) |
| `builder` | `node:24-slim` | Generate Prisma client, run `next build` |
| `runner` | `gcr.io/distroless/nodejs20-debian12:nonroot` | Minimal production image (non-root user) |

**Key details:**
- Uses **Debian (glibc)**, not Alpine (musl) — Tailwind v4's native binaries require glibc
- Puppeteer download is skipped (`PUPPETEER_SKIP_DOWNLOAD=true`) — not needed for production
- Final image runs as **non-root** user for security
- Standalone output is used (configured in `next.config.ts`)

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

A Helm chart is included in `helm/ophirpay/`.

### Deploy with Helm

```bash
# Create namespace
kubectl create namespace ophirpay

# Create secrets
kubectl create secret generic ophirpay-secrets \
  --namespace ophirpay \
  --from-literal=DATABASE_URL="postgresql://..." \
  --from-literal=AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=NEXT_PUBLIC_CONTRACT_ID="<contract-id>" \
  --from-literal=NEXT_PUBLIC_EMITTER_CONTRACT_ID="<emitter-id>"

# Install with Helm
helm upgrade --install ophirpay ./helm/ophirpay \
  --namespace ophirpay \
  --set image.tag=latest \
  --set ingress.hosts[0].host=ophirpay.com \
  --set config.NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC \
  --set config.NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org \
  --set config.NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban.stellar.org \
  --set config.DATABASE_PROVIDER=postgresql \
  --set config.NODE_ENV=production \
  --wait
```

### Verify

```bash
kubectl get pods -n ophirpay
kubectl get ingress -n ophirpay
curl https://ophirpay.com/api/health
```

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

If your `DATABASE_URL` uses a pooled connection (PgBouncer, Neon), set `DIRECT_DATABASE_URL` for migrations:

```env
DATABASE_URL=postgresql://user:pass@ep-xxx.pooler.supabase.com:6543/ophirpay
DIRECT_DATABASE_URL=postgresql://user:pass@ep-xxx.supabase.co:5432/ophirpay
```

Prisma uses `DATABASE_URL` at runtime and `DIRECT_DATABASE_URL` for `migrate deploy`.

### SQLite (Development Only)

```bash
DATABASE_PROVIDER=sqlite npx prisma db push
```

> ⚠️ SQLite is for local development only. Production must use PostgreSQL.

---

## Post-Deployment Verification

Run these checks after deploying:

```bash
# 1. Health check
curl -s https://your-domain.com/api/health | jq .

# 2. Check the dashboard loads
curl -s -o /dev/null -w "%{http_code}" https://your-domain.com/
# Expected: 200

# 3. Check API routes
curl -s -o /dev/null -w "%{http_code}" https://your-domain.com/api/health
# Expected: 200

# 4. Verify database connectivity
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
| `tailwindcss/postcss` crash on musl | Alpine Linux uses musl libc | Use the Debian-based Dockerfile (already configured) or switch to `node:20-slim` |
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
