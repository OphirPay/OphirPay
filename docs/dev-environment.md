# Local Development Environment Guide

This guide helps you set up a local OphirPay development environment from scratch.

## Quick Start (PostgreSQL via Docker)

The repo's `prisma/schema.prisma` is configured for PostgreSQL by default. The fastest way to get a local PostgreSQL instance is via Docker Compose:

```bash
git clone https://github.com/OphirPay/OphirPay.git
cd OphirPay

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Start PostgreSQL + Redis via Docker
docker-compose up -d db redis

# Set DATABASE_URL to match docker-compose.yml
export DATABASE_URL="postgresql://ophirpay:ophirpay@localhost:5432/ophirpay"

# Generate Prisma client
npx prisma generate

# Apply migrations
npx prisma migrate dev

# Seed test data
npm run db:seed

# Start dev server
npm run dev
```

Visit `http://localhost:3000` — the app is running!

## Database Providers

### Option A: PostgreSQL via Docker (Default)

The repo's `prisma/schema.prisma` ships with PostgreSQL as the active datasource.
Use `docker-compose up -d db` for a zero-config local PostgreSQL instance.

To reset: `npx prisma migrate reset` (WARNING: deletes all data)

### Option B: PostgreSQL via Neon (Serverless)

For features requiring serverless edge compatibility or production-like behavior:

```bash
# Install Neon CLI
npm install -g neonctl@latest
neonctl auth
neonctl projects create --name ophirpay-dev --region aws-us-east-1
DATABASE_URL=$(neonctl connection-string --database-name ophirpay)
echo "DATABASE_URL=$DATABASE_URL" >> .env.local
npx prisma migrate dev
npm run db:seed
```

### Option C: SQLite (Experimental)

SQLite is commented out in `prisma/schema.prisma`. To use it, uncomment the SQLite
datasource block and comment out the PostgreSQL block, then use `npx prisma db push`
instead of `npx prisma migrate dev`. Note: some features may not work with SQLite
due to `relationMode = "prisma"` (no foreign keys).

## Stellar Testnet Wallet Funding

### 1. Install Freighter Wallet

1. Download [Freighter](https://freighter.app) browser extension
2. Create a new wallet — save your secret key
3. Switch to **Testnet** in Freighter settings

### 2. Fund with Friendbot

```bash
# Get your public key from Freighter
PUBLIC_KEY="G..."

# Fund via curl
curl -X POST "https://friendbot.stellar.org?addr=$PUBLIC_KEY"

# Or use Stellar Laboratory
open https://laboratory.stellar.org/#account-creator?network=test
```

### 3. Verify Balance

```bash
curl "https://horizon-testnet.stellar.org/accounts/$PUBLIC_KEY" | python3 -m json.tool
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | `postgresql://...` | PostgreSQL connection string |
| `NEXT_PUBLIC_STELLAR_NETWORK` | No | `TESTNET` | `TESTNET` or `PUBLIC` |
| `NEXT_PUBLIC_HORIZON_URL` | No | Testnet Horizon | Horizon API URL |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | No | Testnet RPC | Soroban RPC URL |
| `NEXT_PUBLIC_CONTRACT_ID` | No | - | OphirPay contract ID |
| `NEXT_PUBLIC_EMITTER_CONTRACT_ID` | No | - | Emitter contract ID |

## Verification Checklist

After setup, verify everything works:

- [ ] `npm run dev` starts without errors
- [ ] App loads at `http://localhost:3000`
- [ ] Freighter wallet connects
- [ ] Wallet shows Testnet balance (≥10,000 XLM from friendbot)
- [ ] Can create a payment request
- [ ] `npm test` passes (>800 tests)
- [ ] `npx vitest run --coverage` shows ≥87% coverage

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `prisma migrate dev` fails | Database not reachable | Check `DATABASE_URL` |
| Friendbot returns error | Account already funded | Use a new Freighter account |
| Wallet won't connect | Wrong network | Switch Freighter to Testnet |
| Tests fail | Missing env vars | Copy `.env.example` to `.env.local` |
| Port 3000 in use | Another dev server | `kill $(lsof -t -i:3000)` |

## Next Steps

- [Contributing Guide](../CONTRIBUTING.md)
- [Stellar 101](./STELLAR_101.md)
- [Contract Architecture](./architecture.md)
- [API Cookbook](./API_COOKBOOK.md)
