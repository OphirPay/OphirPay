#!/usr/bin/env bash
#
# scripts/demo-seed.sh
#
# One-click demo seeding for OphirPay.
# Provisions the database with demo data, starts the dev server,
# and opens the browser in demo mode.
#
# Usage: ./scripts/demo-seed.sh

set -euo pipefail

echo "═══════════════════════════════════════════"
echo "  OphirPay — Demo Seed"
echo "═══════════════════════════════════════════"
echo ""

# ── 1. Check prerequisites ────────────────────────────────
command -v node >/dev/null 2>&1 || { echo "✕ Node.js is required"; exit 1; }
echo "✓ Node.js $(node -v)"

# ── 2. Install dependencies ───────────────────────────────
echo ""
echo "→ Installing dependencies..."
npm install --silent 2>/dev/null
echo "✓ Dependencies installed"

# ── 3. Generate Prisma client ──────────────────────────────
echo ""
echo "→ Generating Prisma client..."
npx prisma generate 2>/dev/null
echo "✓ Prisma client generated"

# ── 4. Push schema & seed ─────────────────────────────────
echo ""
echo "→ Seeding database..."
npx prisma db push --accept-data-loss 2>/dev/null
npx prisma db seed 2>/dev/null || echo "  ⚠ seed script not configured — skipping"
echo "✓ Database ready"

# ── 5. Create .env.local with demo mode ────────────────────
if [ ! -f .env.local ]; then
  echo ""
  echo "→ Creating .env.local with demo mode..."
  cat > .env.local << 'EOF'
# Demo mode — no real XLM or Freighter needed
NEXT_PUBLIC_DEMO_MODE=true
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
EOF
  echo "✓ .env.local created"
else
  echo "✓ .env.local exists"
fi

# ── 6. Start dev server ───────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  Starting OphirPay in demo mode..."
echo "  Open http://localhost:3000"
echo "═══════════════════════════════════════════"
echo ""

npm run dev
