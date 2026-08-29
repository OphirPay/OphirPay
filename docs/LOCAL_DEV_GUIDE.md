# OphirPay Local Development & Database Setup Guide

## Overview

This guide provides step-by-step instructions for setting up OphirPay locally using either **SQLite** (zero-config, lightweight local testing) or **Neon PostgreSQL** (serverless cloud Postgres matching production staging), along with database seeding and Stellar Testnet funding.

---

## 1. Quick Start Prerequisites

* **Node.js:** v20+ (`.nvmrc`)
* **Package Manager:** `npm` or `pnpm`
* **Stellar CLI (Optional for Soroban local sandbox):** `soroban-cli` v22+

```bash
git clone https://github.com/OphirPay/OphirPay.git
cd OphirPay
npm install
```

---

## 2. Database Provider Configurations

### Option A: Local SQLite (Fastest Setup)

1. Create `.env.local` using SQLite provider:
   ```env
   DATABASE_URL="file:./dev.db"
   NEXT_PUBLIC_STELLAR_NETWORK="testnet"
   NEXT_PUBLIC_HORIZON_URL="https://horizon-testnet.stellar.org"
   ```

2. Run migrations and seed data:
   ```bash
   npx prisma migrate dev --name init_sqlite
   npm run db:seed
   ```

---

### Option B: Neon Serverless PostgreSQL

1. Create a free database on [Neon.tech](https://neon.tech) and copy your pooled connection string.
2. Update `.env.local`:
   ```env
   DATABASE_URL="postgresql://user:pass@ep-cool-pool.us-east-2.aws.neon.tech/neondb?sslmode=require"
   DIRECT_URL="postgresql://user:pass@ep-cool-pool.us-east-2.aws.neon.tech/neondb?sslmode=require"
   ```
3. Push schema and generate Prisma client:
   ```bash
   npx prisma db push
   npx prisma generate
   npm run db:seed
   ```

---

## 3. Testnet Account Funding & Horizon Setup

To test payment flows locally:
1. Generate a test Stellar keypair:
   ```bash
   npx ts-node scripts/generate-testnet-account.ts
   ```
2. Fund via Friendbot:
   ```bash
   curl "https://friendbot.stellar.org?addr=YOUR_GENERATED_PUBLIC_KEY"
   ```

---

## 4. Common Gotchas & Troubleshooting

| Issue | Cause | Fix |
| :--- | :--- | :--- |
| `PrismaClientInitializationError` | Invalid SSL mode on Neon | Ensure `?sslmode=require` is appended to `DATABASE_URL` |
| `Unsupported provider switch` | Switching between SQLite and PostgreSQL | Delete `prisma/migrations` or run `npx prisma db push --force-reset` |
| `Account not found on Horizon` | Unfunded Testnet keypair | Trigger Friendbot curl request before initiating transactions |
