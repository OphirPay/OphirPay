#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# OphirPay — Pre-Submission Verification
# ══════════════════════════════════════════════════════════════════
# Runs the full quality gate in one shot and prints a pass/fail
# summary. Mirrors the CI pipeline:
#
#   typecheck → lint → prisma → tests → build → contract tests
#
# Usage:
#   bash scripts/check-submission.sh                 # full check
#   SKIP_BUILD=1 bash scripts/check-submission.sh    # skip slow steps
#   DATABASE_URL=postgres://... bash scripts/check-submission.sh
#
# Skippable steps (set to "1" to skip):
#   SKIP_TYPECHECK SKIP_LINT SKIP_PRISMA SKIP_TESTS SKIP_BUILD SKIP_CONTRACTS
#
# Exit code: 0 if everything passed, 1 otherwise.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── Config ──────────────────────────────────────────────────────
SKIP_TYPECHECK="${SKIP_TYPECHECK:-0}"
SKIP_LINT="${SKIP_LINT:-0}"
SKIP_PRISMA="${SKIP_PRISMA:-0}"
SKIP_TESTS="${SKIP_TESTS:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_CONTRACTS="${SKIP_CONTRACTS:-0}"

# prisma validate only parses the schema; it never connects to the DB,
# so a placeholder URL is enough when DATABASE_URL is not exported.
DATABASE_URL="${DATABASE_URL:-postgresql://user:pass@localhost:5432/ophirpay}"
export DATABASE_URL

PASS=0
FAIL=0
FAILED_STEPS=()

print_header() { printf '\n\033[1m%s\033[0m\n' "$1"; }

run_step() {
  local name="$1"
  shift
  print_header "▶ $name"
  if "$@"; then
    printf '  ✅ %s passed\n' "$name"
    PASS=$((PASS + 1))
  else
    printf '  ❌ %s FAILED\n' "$name"
    FAIL=$((FAIL + 1))
    FAILED_STEPS+=("$name")
  fi
}

echo "════════════════════════════════════════════════════════════"
echo "  OphirPay pre-submission verification"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "════════════════════════════════════════════════════════════"

# ── 1. Typecheck ───────────────────────────────────────────────
if [ "$SKIP_TYPECHECK" = "1" ]; then
  echo "ℹ️  Skipping typecheck"
else
  run_step "Typecheck (tsc --noEmit)" npx tsc --noEmit
fi

# ── 2. Lint ────────────────────────────────────────────────────
if [ "$SKIP_LINT" = "1" ]; then
  echo "ℹ️  Skipping lint"
else
  run_step "Lint (eslint, zero warnings)" npx eslint . --max-warnings 0
fi

# ── 3. Prisma (validate + generate) ────────────────────────────
if [ "$SKIP_PRISMA" = "1" ]; then
  echo "ℹ️  Skipping prisma"
else
  run_step "Prisma validate" npx prisma validate
  run_step "Prisma generate" npx prisma generate
fi

# ── 4. Unit tests ──────────────────────────────────────────────
if [ "$SKIP_TESTS" = "1" ]; then
  echo "ℹ️  Skipping unit tests"
else
  run_step "Unit tests (vitest)" npx vitest run
fi

# ── 5. Production build ────────────────────────────────────────
if [ "$SKIP_BUILD" = "1" ]; then
  echo "ℹ️  Skipping build"
else
  run_step "Production build (next build)" npm run build
fi

# ── 6. Contract tests ──────────────────────────────────────────
if [ "$SKIP_CONTRACTS" = "1" ]; then
  echo "ℹ️  Skipping contract tests"
elif ! command -v cargo >/dev/null 2>&1; then
  echo "⚠️  cargo not found — skipping contract tests"
else
  run_step "Contract tests (ophirpay)" bash -c "cd contracts/ophirpay && cargo test --quiet"
  run_step "Contract tests (emitter)" bash -c "cd contracts/emitter && cargo test --quiet"
fi

# ── Summary ────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ RESULTS: $PASS passed · 0 failed — READY FOR SUBMISSION"
  echo "════════════════════════════════════════════════════════════"
  exit 0
else
  echo "  ❌ RESULTS: $PASS passed · $FAIL failed"
  printf '  Failed steps: %s\n' "$(IFS=', '; echo "${FAILED_STEPS[*]}")"
  echo "════════════════════════════════════════════════════════════"
  exit 1
fi
