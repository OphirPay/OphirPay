#!/usr/bin/env bash
# SPDX-License-Identifier: MIT

# Container readiness healthcheck probe script for local docker-compose (issue #2027).
# Checks container health via curl or wget, falling back to node probe script.

set -e

ENDPOINT="${1:-/api/health/live}"
PORT="${PORT:-3000}"
HOST="${HEALTHCHECK_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}${ENDPOINT}"

if command -v curl >/dev/null 2>&1; then
  curl -fsS "$URL" >/dev/null
elif command -v wget >/dev/null 2>&1; then
  wget -q -O - "$URL" >/dev/null
elif command -v node >/dev/null 2>&1; then
  node scripts/healthcheck.js "$ENDPOINT"
else
  echo "No supported healthcheck probe tool available (curl, wget, node)." >&2
  exit 1
fi
