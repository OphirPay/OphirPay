#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# OphirPay — Local E2E runner
# ══════════════════════════════════════════════════════════════════
# playwright.config.ts has no `webServer` block, so the E2E suite needs
# an app that is already running. This script starts one, waits for
# /api/health, runs Playwright against it, then stops the server again.
# Full procedure: docs/testing/e2e-local.md
#
# Usage:
#   bash scripts/e2e-local.sh [options] [playwright args...]
#
# Options:
#   --dev            use `npm run dev` instead of `npm start`
#   --build          run `npm run build` before starting (production mode)
#   --seed           run `npm run db:seed` before starting
#   --port <n>       port for the local server (default: 3000)
#   --keep-server    leave the server running when Playwright exits
#   -h, --help       show this help
#
# Any other argument is forwarded to `npx playwright test`:
#   bash scripts/e2e-local.sh e2e/titles.spec.ts --project=chromium
#   npm run test:e2e:local -- --project=chromium
#
# Environment:
#   E2E_BASE_URL         run against this URL instead of a local server
#   SERVER_WAIT_SECONDS  health-check timeout in seconds (default: 120)
#
# Exit code: Playwright's exit code (0 = all tests passed).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

PORT=3000
MODE="prod" # prod | dev
BUILD=0
SEED=0
KEEP_SERVER=0
WAIT_SECONDS="${SERVER_WAIT_SECONDS:-120}"
PLAYWRIGHT_ARGS=()
SERVER_PID=""
SERVER_LOG=""

usage() {
  cat <<'EOF'
OphirPay — local E2E runner

Starts the app, waits for /api/health, runs Playwright, stops the server.

Usage:
  bash scripts/e2e-local.sh [options] [playwright args...]

Options:
  --dev            use `npm run dev` instead of `npm start`
  --build          run `npm run build` before starting (production mode)
  --seed           run `npm run db:seed` before starting
  --port <n>       port for the local server (default: 3000)
  --keep-server    leave the server running when Playwright exits
  -h, --help       show this help

Any other argument is forwarded to `npx playwright test`:
  bash scripts/e2e-local.sh e2e/titles.spec.ts --project=chromium
  npm run test:e2e:local -- --project=chromium

Environment:
  E2E_BASE_URL         run against this URL instead of a local server
  SERVER_WAIT_SECONDS  health-check timeout in seconds (default: 120)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dev)
      MODE="dev"
      shift
      ;;
    --build)
      BUILD=1
      shift
      ;;
    --seed)
      SEED=1
      shift
      ;;
    --keep-server)
      KEEP_SERVER=1
      shift
      ;;
    --port)
      if [ $# -lt 2 ]; then
        echo "✕ --port needs a value" >&2
        exit 2
      fi
      PORT="$2"
      shift 2
      ;;
    --port=*)
      PORT="${1#--port=}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      while [ $# -gt 0 ]; do
        PLAYWRIGHT_ARGS+=("$1")
        shift
      done
      ;;
    *)
      PLAYWRIGHT_ARGS+=("$1")
      shift
      ;;
  esac
done

case "$PORT" in
  '' | *[!0-9]*)
    echo "✕ Invalid port: '$PORT'" >&2
    exit 2
    ;;
esac

# E2E_BASE_URL set → run against that target and manage no server.
if [ -n "${E2E_BASE_URL:-}" ]; then
  BASE_URL="$E2E_BASE_URL"
  MANAGE_SERVER=0
else
  BASE_URL="http://localhost:${PORT}"
  MANAGE_SERVER=1
fi
HEALTH_URL="${BASE_URL%/}/api/health"

# ── Helpers ─────────────────────────────────────────────────────

health_ok() {
  # The health route pings Soroban RPC and Horizon (5 s timeouts each), so on
  # a machine without a route to Stellar a healthy response can take ~10 s.
  curl -fsS --max-time 15 -o /dev/null "$HEALTH_URL" >/dev/null 2>&1
}

kill_tree() {
  local pid="$1" child
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
      kill_tree "$child"
    done
  fi
  kill "$pid" 2>/dev/null || true
}

# Prints "pid child grandchild …" for pid and all its descendants (best effort),
# so the --keep-server hint can name every process the user must stop.
process_tree() {
  local pid="$1" child
  printf '%s' "$pid"
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
      printf ' %s' "$(process_tree "$child")"
    done
  fi
}

cleanup() {
  local status=$?
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    if [ "$KEEP_SERVER" -eq 1 ]; then
      echo ""
      echo "ℹ️  Server left running — stop it (npm + its next-server child) with:"
      echo "     kill $(process_tree "$SERVER_PID")"
    else
      echo ""
      echo "→ Stopping server (PID $SERVER_PID)..."
      kill_tree "$SERVER_PID"
      wait "$SERVER_PID" 2>/dev/null || true
    fi
  fi
  if [ -n "$SERVER_LOG" ] && [ "$KEEP_SERVER" -eq 0 ]; then
    rm -f "$SERVER_LOG"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

wait_for_health() {
  local start="$SECONDS"
  while [ $((SECONDS - start)) -lt "$WAIT_SECONDS" ]; do
    if health_ok; then
      return 0
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "✕ The server exited before becoming healthy." >&2
      echo "  Last log lines (${SERVER_LOG}):" >&2
      tail -n 20 "$SERVER_LOG" >&2 || true
      return 1
    fi
    sleep 1
  done
  echo "✕ Timed out after ${WAIT_SECONDS}s waiting for ${HEALTH_URL}." >&2
  echo "  Last log lines (${SERVER_LOG}):" >&2
  tail -n 20 "$SERVER_LOG" >&2 || true
  return 1
}

# ── Main ────────────────────────────────────────────────────────

echo "════════════════════════════════════════════════════════════"
echo "  OphirPay — local E2E run"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "════════════════════════════════════════════════════════════"

command -v curl >/dev/null 2>&1 || {
  echo "✕ curl is required to poll /api/health." >&2
  exit 1
}
[ -d node_modules ] || {
  echo "✕ node_modules not found — run 'npm ci' first." >&2
  exit 1
}

if health_ok; then
  echo "✓ Server already healthy at ${BASE_URL} — reusing it."
elif [ "$MANAGE_SERVER" -eq 0 ]; then
  echo "→ E2E_BASE_URL is set (${BASE_URL}) — no local server managed."
  echo "⚠️  ${HEALTH_URL} did not answer 200 — the run may fail."
  case "$BASE_URL" in
    http://localhost:* | http://127.0.0.1:*)
      echo "   If this is meant to be a local run, unset E2E_BASE_URL so the script starts the server."
      ;;
  esac
else
  if [ "$MODE" = "prod" ] && [ "$BUILD" -eq 0 ] && [ ! -f .next/BUILD_ID ]; then
    echo "✕ No production build found (.next/BUILD_ID is missing)." >&2
    echo "  Run 'npm run build' first, or re-run with --build." >&2
    exit 1
  fi
  if [ "$SEED" -eq 1 ]; then
    echo "→ Seeding database (npm run db:seed)..."
    npm run db:seed || exit 1
  fi
  if [ "$BUILD" -eq 1 ]; then
    echo "→ Building (npm run build)..."
    npm run build || exit 1
  fi
  SERVER_LOG="$(mktemp "${TMPDIR:-/tmp}/ophirpay-e2e-server.XXXXXX")"
  if [ "$MODE" = "dev" ]; then
    SERVER_CMD=(npm run dev -- -p "$PORT")
  else
    SERVER_CMD=(npm start -- -p "$PORT")
  fi
  echo "→ Starting server: ${SERVER_CMD[*]}  (log: ${SERVER_LOG})"
  "${SERVER_CMD[@]}" >"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  echo "→ Waiting for ${HEALTH_URL} ..."
  if ! wait_for_health; then
    exit 1
  fi
  echo "✓ Server healthy at ${BASE_URL} (PID ${SERVER_PID})."
fi

export E2E_BASE_URL="$BASE_URL"

echo ""
echo "→ npx playwright test ${PLAYWRIGHT_ARGS[*]-}"
echo ""
if [ "${#PLAYWRIGHT_ARGS[@]}" -gt 0 ]; then
  npx playwright test "${PLAYWRIGHT_ARGS[@]}"
else
  npx playwright test
fi
