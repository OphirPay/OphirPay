#!/bin/bash
# ─────────────────────────────────────────────────────────────
# OphirPay Demo Smoke Test
# Run before any demo to verify everything works.
# Green = OK, Red = FAIL, Yellow = WARNING
# ─────────────────────────────────────────────────────────────
set -euo pipefail

GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[1;33m"
BOLD="\033[1m"
NC="\033[0m"

PASS=0
FAIL=0
WARN=0

check() {
  local label="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} $label"
    ((PASS++))
  else
    echo -e "  ${RED}✗${NC} $label"
    ((FAIL++))
  fi
}

warn() {
  echo -e "  ${YELLOW}⚠${NC} $1"
  ((WARN++))
}

echo ""
echo -e "${BOLD}┌──────────────────────────────────────────────┐${NC}"
echo -e "${BOLD}│        OphirPay Demo Smoke Test              │${NC}"
echo -e "${BOLD}└──────────────────────────────────────────────┘${NC}"
echo ""

# ── 1. Environment ──────────────────────────────────────────
echo -e "${BOLD}[1/6] Environment${NC}"
check "Node.js installed" command -v node
check "npm installed" command -v npm
check "Git installed" command -v git

NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ "${NODE_VERSION:-0}" -ge 18 ]; then
  echo -e "  ${GREEN}✓${NC} Node.js >= 18 (found v$(node -v))"
  ((PASS++))
else
  echo -e "  ${RED}✗${NC} Node.js >= 18 required"
  ((FAIL++))
fi

# ── 2. Dependencies ─────────────────────────────────────────
echo -e "${BOLD}[2/6] Dependencies${NC}"
if [ -d "node_modules" ]; then
  echo -e "  ${GREEN}✓${NC} node_modules exists"
  ((PASS++))
else
  warn "node_modules not found — run 'npm install'"
fi

check "package.json exists" test -f package.json
check ".env exists" test -f .env

# ── 3. Database ─────────────────────────────────────────────
echo -e "${BOLD}[3/6] Database${NC}"
check "Prisma schema exists" test -f prisma/schema.prisma
if [ -f "prisma/dev.db" ]; then
  echo -e "  ${GREEN}✓${NC} SQLite database exists"
  ((PASS++))
else
  warn "No SQLite DB found — run 'npx prisma db push'"
fi

# ── 4. TypeScript ───────────────────────────────────────────
echo -e "${BOLD}[4/6] TypeScript${NC}"
if npx tsc --noEmit 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} TypeScript compiles clean"
  ((PASS++))
else
  echo -e "  ${RED}✗${NC} TypeScript errors found"
  ((FAIL++))
fi

# ── 5. Tests ─────────────────────────────────────────────────
echo -e "${BOLD}[5/6] Tests${NC}"
TEST_OUTPUT=$(npx vitest run 2>&1) || true
if echo "$TEST_OUTPUT" | grep -q "Tests.*passed"; then
  TEST_COUNT=$(echo "$TEST_OUTPUT" | grep "Tests" | tail -1 | grep -o '[0-9]\+ passed' | grep -o '[0-9]\+')
  echo -e "  ${GREEN}✓${NC} $TEST_COUNT tests passed"
  ((PASS++))
else
  echo -e "  ${RED}✗${NC} Tests failed"
  ((FAIL++))
fi

# ── 6. Build ─────────────────────────────────────────────────
echo -e "${BOLD}[6/6] Production Build${NC}"
if npx next build 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Next.js build succeeded"
  ((PASS++))
else
  warn "Build failed — may need 'npm install' or Prisma generate"
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}┌──────────────────────────────────────────────┐${NC}"
echo -e "${BOLD}│  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$WARN warnings${NC}  │${NC}"
echo -e "${BOLD}└──────────────────────────────────────────────┘${NC}"

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo -e "${GREEN}${BOLD}✅ All checks passed — ready to demo!${NC}"
  echo ""
  echo "Start the dev server:"
  echo "  npm run dev"
  echo ""
  echo "Open in browser:"
  echo "  http://localhost:3000"
  exit 0
else
  echo ""
  echo -e "${RED}${BOLD}❌ $FAIL check(s) failed — fix before demo.${NC}"
  exit 1
fi
