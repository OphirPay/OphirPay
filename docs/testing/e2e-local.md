# Running the End-to-End (E2E) Test Suite Locally

This guide explains how to configure, provision, and execute the Playwright End-to-End (E2E) test suite locally on your machine.

---

## 1. Overview & The Server Requirement

`playwright.config.ts` deliberately does **not** include a `webServer` block. This design allows Playwright to run interchangeably against:
- Local development servers (`http://localhost:3000`)
- Production preview builds (`npm run start`)
- Live staging deployments via the `E2E_BASE_URL` environment variable

> [!IMPORTANT]
> If you run `npm run test:e2e` without an active application instance listening on `E2E_BASE_URL` (default: `http://localhost:3000`), tests will immediately fail with connection refused errors (`ERR_CONNECTION_REFUSED`).

You can satisfy this requirement in two ways:
1. **Automated Runner (Recommended):** Use `npm run test:e2e:local` (`scripts/e2e-local.sh`), which manages server startup, `/api/health` polling, and shutdown automatically.
2. **Manual Startup:** Start the server in one terminal and run Playwright in another.

---

## 2. Prerequisites & Environment Setup

### 1. Install Dependencies & Playwright Browsers

```bash
# Install Node dependencies
npm install

# Download required browser binaries (Chromium, Firefox, WebKit)
npx playwright install --with-deps
```

### 2. Configure Environment Variables

Create a `.env.local` or `.env` file based on `.env.example`:

```bash
cp .env.example .env.local
```

Ensure the following variables are present:
```ini
# Base URL for Playwright tests
E2E_BASE_URL=http://localhost:3000

# Stellar network configuration
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org:443

# Database configuration (PostgreSQL or SQLite)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ophirpay?schema=public"
# Or for local SQLite development:
# DATABASE_URL="file:./dev.db"

# Internal secrets for cron and scheduled payment routes
CRON_SECRET=e2e-test-cron-secret-123456789
```

### 3. Provision & Seed the Database

The E2E suite expects seed data (demo users, payment records, batches, and refund entries) in the database:

```bash
# Push schema to database
npx prisma db push

# Populate initial seed records
npm run db:seed
```

---

## 3. Starting the Server Manually

Before running raw Playwright commands (`npm run test:e2e`), start the application server:

### Production Build (Recommended for Speed and Parity)
```bash
# Build production bundle
npm run build

# Start production server on port 3000
npm start
```

### Development Mode (For Rapid Debugging)
```bash
npm run dev
```

### Verify Readiness
Confirm the server is healthy before invoking tests:
```bash
curl -sf http://localhost:3000/api/health
# Should return {"status":"ok",...} with HTTP 200
```

---

## 4. The One-Command Convenience Runner (`npm run test:e2e:local`)

For hands-free execution, use the automated runner:

```bash
# Run all tests using production build
npm run test:e2e:local

# Run using dev server instead of production build
npm run test:e2e:local -- --dev

# Run specific spec on Chromium
npm run test:e2e:local -- --project=chromium e2e/titles.spec.ts

# Specify custom port
npm run test:e2e:local -- --port 3001
```

### What `scripts/e2e-local.sh` Does:
1. Checks if a server is already healthy at `E2E_BASE_URL` (reuses if running).
2. If no server is running, compiles the app (if `.next` is missing) and starts the server in the background.
3. Polls `/api/health` until the server responds with HTTP 200 (up to 45s).
4. Invokes Playwright with all passed CLI arguments.
5. Captures `EXIT`, `INT`, and `TERM` signals to cleanly terminate the background server upon test completion.

---

## 5. The Three Playwright Configurations

OphirPay maintains three distinct Playwright configurations:

| Suite | Configuration File | Command | Scope & Purpose |
| :--- | :--- | :--- | :--- |
| **Functional E2E** | `playwright.config.ts` | `npm run test:e2e`<br>`npm run test:e2e:ui` | Full-stack user journeys: payment submission, batch disbursement, multisig proposals, refunds, error codes, titles, service worker. |
| **Visual Regression** | `playwright.visual.config.ts` | `npm run test:visual`<br>`npm run test:visual:update` | Compares pixel snapshots across desktop and mobile viewports (`public/screenshots/`). |
| **Accessibility (a11y)** | `playwright.config.ts` | `npm run test:a11y` | Automated WCAG 2.1 AA accessibility checks via `@axe-core/playwright` (`e2e/accessibility.spec.ts`). |

---

## 6. Targeting Specific Projects, Shards, and Specs

### Target by Browser Project
Defined in `playwright.config.ts`:
```bash
# Run on Desktop Chrome only
npm run test:e2e -- --project=chromium

# Run on Desktop Firefox
npm run test:e2e -- --project=firefox

# Run on Mobile Pixel 5
npm run test:e2e -- --project=mobile-chrome

# Run service worker test (which requires service workers enabled)
npm run test:e2e -- --project=service-worker
```

### Target Specific Spec Files
```bash
# Test page titles and metadata
npm run test:e2e -- e2e/titles.spec.ts

# Test multisig workflow
npm run test:e2e -- e2e/multisig-flow.spec.ts
```

### Interactive UI Mode & Debugging
```bash
# Open interactive Playwright UI
npm run test:e2e:ui

# Step through tests with Playwright Inspector
npx playwright test --debug
```

### Parallel Sharding (CI / Distributed Workers)
```bash
# Run first shard of three
npm run test:e2e -- --shard=1/3

# Run second shard of three
npm run test:e2e -- --shard=2/3
```

---

## 7. Mocked vs. Unmocked Test Specs

To keep tests fast, reliable, and independent of real blockchain faucets, complex on-chain flows use deterministic browser-side mock helpers located in `e2e/helpers/`:

| Spec File | Helper Module Used | What is Mocked vs. Real |
| :--- | :--- | :--- |
| **`e2e/multisig-flow.spec.ts`** | `e2e/helpers/stellar-mock.ts` | Injects `fakeFreighterInitScript` into the page to simulate Freighter wallet signing and intercepts Soroban contract RPC calls. |
| **`e2e/notifications.spec.ts`** | `e2e/helpers/sse-mock.ts` | Intercepts `/api/events` Server-Sent Events (SSE) connections to push synthetic event frames (`payment:created`, `heartbeat`) deterministically. |
| **`e2e/refunds.spec.ts`** | `e2e/helpers/refunds-mock.ts`<br>`e2e/helpers/stellar-mock.ts` | Mocks refund ledger state and wallet signature verification for refund approval and processing. |
| **`e2e/admin-fee-config.spec.ts`<br>`e2e/admin-hooks.spec.ts`<br>`e2e/admin-keys.spec.ts`<br>`e2e/admin-rbac.spec.ts`<br>`e2e/pause-controls.spec.ts`<br>`e2e/timelock.spec.ts`** | `e2e/helpers/admin-mocks.ts` | Uses an in-memory mutable store (`installAdminMocks`) to simulate admin permission changes and system configurations without corrupting persistent database state. |
| **`e2e/titles.spec.ts`<br>`e2e/dashboard.spec.ts`<br>`e2e/api.spec.ts`<br>`e2e/accessibility.spec.ts`<br>`e2e/service-worker.spec.ts`<br>`e2e/batch-creation-mobile.spec.ts`** | *(None — Unmocked)* | Run directly against live Next.js App Router endpoints and seeded database state. |

---

## 8. Troubleshooting & Common Pitfalls

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **`ERR_CONNECTION_REFUSED: http://localhost:3000`** | No server is running on port 3000. | Start the server with `npm start` / `npm run dev`, or use `npm run test:e2e:local`. |
| **`404 Not Found` or Empty Tables** | Database was not seeded. | Run `npx prisma db push && npm run db:seed`. |
| **SSE / Mock Interception Ignored** | Service worker cached the fetch request. | `playwright.config.ts` blocks service workers by default (`serviceWorkers: "block"`). For `service-worker.spec.ts`, run `--project=service-worker`. |
| **Port 3000 Collision** | Another service is using port 3000. | Run on another port: `PORT=3001 npm start`, then run `E2E_BASE_URL=http://localhost:3001 npm run test:e2e`. |
| **Browser Not Found** | Missing Playwright browser binaries. | Run `npx playwright install chromium firefox`. |
