# OphirPay Demo Mode & Seeded Environment Guide

This document describes OphirPay's **Demo Mode**, the seeded test environment, automated verification scripts, and asset capture workflows.

---

## 1. Overview & Purpose

OphirPay includes a dedicated demo mode and automated database seeding machinery designed for:
- **Hackathon & Evaluator Walkthroughs:** Reviewers can explore the full feature set without needing a funded Stellar wallet or browser extension.
- **CI Previews & Visual Regression:** Deterministic test data enables reproducible UI snapshots and end-to-end tests.
- **Local Development & Onboarding:** New contributors can spin up a fully populated local environment in a single command.

---

## 2. The `NEXT_PUBLIC_DEMO_MODE` Flag & Behavioral Effects

Demo mode is toggled via the `NEXT_PUBLIC_DEMO_MODE` environment variable in `.env.local` or `.env`:

```bash
NEXT_PUBLIC_DEMO_MODE=true
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
```

### Behavioral Changes (`src/lib/demo-mode.ts`)

| Feature | Production Mode (`false` / unset) | Demo Mode (`true`) |
| :--- | :--- | :--- |
| **`isDemoMode()`** | Returns `false`. | Returns `true`. |
| **Wallet Connection** | Requires Freighter or compatible Stellar wallet extension. | Fallback to `DEMO_WALLET` (`GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO`) with simulated 10,000.00 XLM balance. |
| **Transaction Signing** | Requires user signature and on-chain Soroban/Horizon submission. | `simulatePayment()` / `simulateBatchPayment()` return instant simulated results (`status: "RECORDED"`, `demo: true`) with deterministic hashes (`generateDemoTxHash()`). |
| **Dashboard Data** | Loaded live from PostgreSQL/SQLite database. | Populated with demo fixtures (`DEMO_PAYMENTS`, `DEMO_EVENTS`, `DEMO_MULTISIG`, `DEMO_PROPOSALS`) when database is empty. |

### Security Considerations & Safeguards

> [!IMPORTANT]
> **Mainnet Prohibition:** Demo mode MUST NEVER be enabled against Stellar Mainnet (`NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC`). The environment validator (`src/lib/env.ts`) actively validates network settings.

> [!NOTE]
> **API Integrity Preserved:** `src/lib/demo-mode.ts` provides client-side simulation helpers and UI fixtures. Backend API routes (`/api/payments`, `/api/escrows`, `/api/batches`, `/api/webhooks`) still enforce CSRF validation (`verifyCsrf`), session/API-key authentication (`getAuthContext`), and database schema integrity. No security checks are bypassed on the server.

---

## 3. Seeding the Demo Environment

### Automated Setup (`scripts/demo-seed.sh`)

To provision and launch the demo environment in one step:

```bash
./scripts/demo-seed.sh
```

The script executes the following automated pipeline:
1. **Prerequisite Check:** Verifies Node.js (>= 18) is installed.
2. **Dependency Installation:** Runs `npm install --silent`.
3. **Prisma Generation:** Runs `npx prisma generate` to build client types.
4. **Database Provisioning & Seeding:** Runs `npx prisma db push --accept-data-loss` and seeds records via `npm run db:seed` (`prisma/seed.ts`).
5. **Environment Configuration:** Creates `.env.local` setting `NEXT_PUBLIC_DEMO_MODE=true` and `NEXT_PUBLIC_STELLAR_NETWORK=TESTNET` if not already present.
6. **Server Startup:** Boots the Next.js development server at `http://localhost:3000`.

### Database Entities Created by `prisma/seed.ts`

| Entity Type | Details Seeded | Purpose |
| :--- | :--- | :--- |
| **User** | ID: `seed-user-1`, Name: `OphirPay Demo`, Address: `GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U` | Primary user context for authentication and dashboard stats. |
| **Payments (5)** | • 500 XLM — "Monthly subscription payment" (`COMPLETED`)<br>• 250 XLM — "Freelance invoice #42" (`COMPLETED`)<br>• 1500 XLM — "Vendor payment — cloud hosting" (`COMPLETED`)<br>• 100 XLM — "Test payment" (`PENDING`)<br>• 75 XLM — "Coffee fund contribution" (`FAILED`) | Demonstrates status filtering, search indexing, and pagination across all lifecycle states. |
| **Batch (1)** | Name: `Demo Batch — Monthly Payroll`, Status: `COMPLETED` | Displays batch disbursement tracking. |
| **Refunds (4)** | • Reason 0: "Product arrived defective" (`PROCESSED`)<br>• Reason 1: "Never received the service" (`APPROVED`)<br>• Reason 2: "Charged twice by mistake" (`REQUESTED`)<br>• Reason 3: "Unauthorized transaction" (`REJECTED`) | Exercises complete refund state machine and reason-code catalog. |
| **Notification Hooks (3)** | `payment_recorded`, `refund_processed`, `escrow_created` pointing to `https://example.com/webhooks/*` | Illustrates webhook delivery and event routing configurations. |

---

## 4. Smoke Testing & Verification (`scripts/demo-test.sh`)

Before conducting a demo or recording visual assets, verify system readiness using the smoke test script:

```bash
./scripts/demo-test.sh
```

The script executes 6 automated checks:
1. **`[1/6] Environment:`** Verifies Node.js (>= 18), npm, and git.
2. **`[2/6] Dependencies:`** Validates `node_modules`, `package.json`, and `.env` presence.
3. **`[3/6] Database:`** Confirms Prisma schema exists and SQLite (`prisma/dev.db`) or PostgreSQL database is accessible.
4. **`[4/6] TypeScript:`** Runs `npx tsc --noEmit` to ensure clean typechecking.
5. **`[5/6] Tests:`** Runs `npx vitest run` to ensure unit and integration tests pass.
6. **`[6/6] Production Build:`** Executes `npx next build` to guarantee bundle compilation without errors.

---

## 5. Teardown & Environment Reset

To reset the database to a clean state:

### For SQLite Development
```bash
# Remove SQLite database and local demo overrides
rm -f prisma/dev.db prisma/dev.db-journal .env.local

# Re-initialize clean schema and seed
npx prisma db push
npm run db:seed
```

### For PostgreSQL Development
```bash
# Reset database schema and rerun seed
npx prisma migrate reset --force

# Or alternatively push clean schema
npx prisma db push --force-reset
npm run db:seed
```

### Clearing Next.js Build Cache
```bash
rm -rf .next
```

---

## 6. Screenshot & Video Asset Capture

Captured assets reside in `public/screenshots/` and `public/demo.mp4`.

### Capturing Screenshots (`scripts/capture-screenshots.js`)

Requirements: A running OphirPay instance (`npm run dev` on `http://localhost:3000`) and Puppeteer.

```bash
# In terminal 1:
npm run dev

# In terminal 2:
node scripts/capture-screenshots.js
```

The script navigates to key application routes with a 1440x900 viewport:
- `http://localhost:3000` → `public/screenshots/dashboard.png`
- `http://localhost:3000/payments` → `public/screenshots/payments.png`
- `http://localhost:3000/send` → `public/screenshots/send-payment.png`
- `http://localhost:3000/batches` → `public/screenshots/batches.png`
- `http://localhost:3000/batches/new` → `public/screenshots/batch-new.png`

### Capturing Mockup Previews (`scripts/capture-mockups.js`)

To capture static UI mockups from `scripts/mockups/`:

```bash
node scripts/capture-mockups.js
```

### Recording Demo Video (`public/demo.mp4`)

When recording a fresh demo video walkthrough:
1. **Screen Resolution:** 1920x1080 (1080p Full HD) at 30 or 60 FPS.
2. **Audio / Format:** Clean audio narration, MP4 container with H.264 video and AAC audio codecs.
3. **Recommended Narrative Flow:**
   - **0:00 - 0:30:** Dashboard overview, active balances, and real-time event feed.
   - **0:30 - 1:00:** Creating and submitting a payment (instant demo mode confirmation).
   - **1:00 - 1:45:** Multi-recipient batch payroll disbursement.
   - **1:45 - 2:30:** Refund lifecycle walkthrough (Requested → Approved → Processed).
   - **2:30 - 3:00:** Governance proposal review and voting.

---

## 7. Demo Credentials & Key Catalog

All addresses and keys used in demo mode are public testnet fixtures with no monetary value:

| Context | Public Key / Identifier | Sensitive? |
| :--- | :--- | :--- |
| **Demo Wallet** | `GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO` | No (Public testnet address only, no private key stored) |
| **Seeded User** | `GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U` | No (Testnet public address) |
| **Seeded User ID** | `seed-user-1` | No (Internal mock database identifier) |

---

## 8. Summary Checklist for Demo Presenters

- [ ] Run `./scripts/demo-test.sh` to confirm all 6 checks pass.
- [ ] Verify `NEXT_PUBLIC_STELLAR_NETWORK=TESTNET` in `.env.local`.
- [ ] Run `./scripts/demo-seed.sh` to initialize sample payments and refunds.
- [ ] Confirm browser opens to `http://localhost:3000` with pre-populated demo data.
