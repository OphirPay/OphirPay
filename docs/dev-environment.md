# Local Development Environment Guide

This guide helps you set up a local OphirPay development environment from scratch.

## Quick Start (SQLite)

For rapid prototyping and testing, use SQLite:

```bash
git clone https://github.com/OphirPay/OphirPay.git
cd OphirPay

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Generate Prisma client (SQLite)
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

### Option A: SQLite (Recommended for Development)

| Pros | Cons |
|------|------|
| Zero setup | No concurrent writes |
| Instant startup | Not suitable for production |
| File-based (easy reset) | Limited to single process |

Delete `prisma/dev.db` and re-run `npx prisma migrate dev` to reset.

### Option B: PostgreSQL / Neon

For features requiring serverless edge compatibility or production-like behavior:

```bash
# Install Neon CLI
npm install -g neonctl@latest

# Authenticate
neonctl auth

# Create a project
neonctl projects create --name ophirpay-dev --region aws-us-east-1

# Get the connection string
DATABASE_URL=$(neonctl connection-string --database-name ophirpay)

# Update .env.local
echo "DATABASE_URL=$DATABASE_URL" >> .env.local
echo "DATABASE_PROVIDER=postgresql" >> .env.local

# Apply migrations
npx prisma migrate dev

# Seed
npm run db:seed
```

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
| `DATABASE_URL` | Yes | `file:./dev.db` | Database connection string |
| `DATABASE_PROVIDER` | No | `sqlite` | `sqlite` or `postgresql` |
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
