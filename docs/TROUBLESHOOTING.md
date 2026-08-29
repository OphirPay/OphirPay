# Troubleshooting Guide

This guide covers common setup and runtime issues when developing or running OphirPay locally.

## Table of Contents

- [Environment setup](#environment-setup)
- [Database connection](#database-connection)
- [Wallet connection](#wallet-connection)
- [Contract calls](#contract-calls)
- [Build and TypeScript errors](#build-and-typescript-errors)
- [Tests](#tests)

---

## Environment setup

### `MODULE_NOT_FOUND` or missing environment variables

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
2. Fill in at least:
   - `DATABASE_URL`
   - `NEXTAUTH_SECRET`
   - `NEXT_PUBLIC_STELLAR_NETWORK=TESTNET`
3. Restart the dev server so Next.js picks up the new env file.

### Node version mismatch

This project uses the Node version pinned in `.nvmrc`. Use a version manager:

```bash
nvm use
```

If you do not have `nvm`, install the matching Node major version manually.

---

## Database connection

### Prisma migration errors during `npm run db:migrate`

- Verify `DATABASE_URL` points to a reachable PostgreSQL or SQLite instance.
- For local development, SQLite is the fastest path. Use a URL like:
  ```
  DATABASE_URL="file:./dev.db"
  ```
- For PostgreSQL via Neon, ensure the connection string includes the correct password and is not expired.

### "Foreign key constraint failed" or missing tables

Run the full migration and seed sequence:

```bash
npm run db:migrate
npm run db:seed
```

---

## Wallet connection

### Freighter does not connect

1. Install the [Freighter browser extension](https://www.freighter.app/).
2. Create or import an account and switch it to **Testnet**.
3. Fund the account with [Friendbot](https://laboratory.stellar.org/#account-creator?network=test).

### "No supported wallet found" error

Only Freighter is supported out of the box. Other wallets (e.g., Albedo) are not wired into the current auth flow.

---

## Contract calls

### Simulation failed or contract not found

- Confirm `NEXT_PUBLIC_EMITTER_CONTRACT_ID` and `NEXT_PUBLIC_OPHIRPAY_CONTRACT_ID` match the testnet addresses in `.env.example`.
- Check that your account has enough XLM on testnet for the simulation fee.
- If the contract was redeployed, update the IDs from the latest deployment runbook.

### Transaction submission fails

- Verify the network badge in the UI shows **TESTNET**.
- Ensure your Freighter account has a positive XLM balance.
- Look at the browser console and server logs for the exact Soroban error code.

---

## Build and TypeScript errors

### `tsc` errors after pulling `main`

```bash
npm ci
npm run type-check
```

If the error persists, delete `.next` and `node_modules/.cache`:

```bash
rm -rf .next node_modules/.cache
npm run build
```

### Tailwind class warnings

OphirPay uses `cn()` for conditional classes. Avoid dynamic class names like `bg-${color}-500`; use a static map instead.

---

## Tests

### Vitest fails with environment errors

Make sure the test environment is configured:

```bash
npm run test -- --run
```

For tests that need `jsdom`, ensure the test file imports from `@testing-library/react` and that `vitest.setup.ts` is loaded (configured in `vitest.config.ts`).

### Playwright E2E tests timeout

- Start the dev server first: `npm run dev`
- Ensure port 3000 is free.
- For CI, `playwright.config.ts` uses the built-in webServer option to start the app automatically.

---

## Still stuck?

1. Check the server logs for the full stack trace.
2. Search existing [GitHub issues](https://github.com/OphirPay/OphirPay/issues) for the error message.
3. Open a new issue with:
   - Steps to reproduce
   - Expected vs actual behavior
   - Relevant environment variables (redact secrets)
   - Full error output
