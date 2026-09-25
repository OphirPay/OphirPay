#!/usr/bin/env bash
#
# scripts/e2e-local.sh
#
# Convenience runner for executing Playwright E2E suites locally.
# Checks if an instance is listening on E2E_BASE_URL (or default port 3000),
# starts the server if not already running, waits for /api/health,
# executes Playwright with passed arguments, and cleanly terminates
# any spawned server process on exit.
#
# Usage:
#   bash scripts/e2e-local.sh [playwright options]
#   bash scripts/e2e-local.sh --project=chromium e2e/titles.spec.ts
#   bash scripts/e2e-local.sh --dev --project=chromium
#

set -euo pipefail

PORT="${PORT:-3000}"
USE_DEV=false
KEEP_SERVER=false
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="$2"
      shift 2
      ;;
    --dev)
      USE_DEV=true
      shift
      ;;
    --keep-server)
      KEEP_SERVER=true
      shift
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

BASE_URL="${E2E_BASE_URL:-http://localhost:${PORT}}"
HEALTH_URL="${BASE_URL}/api/health"
SERVER_PID=""

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && [[ "${KEEP_SERVER}" != "true" ]]; then
    echo "Stopping background server (PID ${SERVER_PID})..."
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "══════════════════════════════════════════════════════════════"
echo "  OphirPay Local E2E Runner"
echo "  Target: ${BASE_URL}"
echo "══════════════════════════════════════════════════════════════"

# Check if server is already running and healthy
if curl -sf --max-time 2 "${HEALTH_URL}" >/dev/null 2>&1; then
  echo "✓ Server is already running and healthy at ${HEALTH_URL}"
else
  echo "→ No server detected at ${HEALTH_URL}. Starting server on port ${PORT}..."

  if [[ "${USE_DEV}" == "true" ]]; then
    echo "→ Starting dev server (npm run dev)..."
    PORT="${PORT}" npm run dev >/dev/null 2>&1 &
    SERVER_PID=$!
  else
    if [[ ! -d ".next" ]]; then
      echo "→ No production build found in .next. Building app (npm run build)..."
      npm run build
    fi
    echo "→ Starting production server (npm start)..."
    PORT="${PORT}" npm start >/dev/null 2>&1 &
    SERVER_PID=$!
  fi

  echo "→ Waiting for server to become healthy at ${HEALTH_URL}..."
  MAX_WAIT=45
  WAITED=0
  until curl -sf --max-time 1 "${HEALTH_URL}" >/dev/null 2>&1; do
    sleep 1
    WAITED=$((WAITED + 1))
    if [[ ${WAITED} -ge ${MAX_WAIT} ]]; then
      echo "✕ Server failed to start and report healthy within ${MAX_WAIT}s."
      exit 1
    fi
  done
  echo "✓ Server is ready after ${WAITED}s."
fi

export E2E_BASE_URL="${BASE_URL}"

echo ""
echo "→ Running Playwright tests..."
if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  npx playwright test "${EXTRA_ARGS[@]}"
else
  npx playwright test
fi
