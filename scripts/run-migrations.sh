#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Runs Prisma schema migrations for Docker/Kubernetes pre-upgrade jobs (#1335).
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required to run prisma migrate deploy" >&2
  exit 1
fi

echo "Applying pending Prisma migrations via 'prisma migrate deploy'..."
npx prisma migrate deploy
echo "Prisma migrations applied successfully."
