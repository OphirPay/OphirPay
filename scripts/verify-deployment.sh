#!/usr/bin/env bash
set -e
echo "Verifying deployment..."
# Dummy check
if [ "$ALLOWED_SOURCE" != "$ORCHESTRATOR" ]; then
  echo "Error: ALLOWED_SOURCE does not match orchestrator"
  exit 1
fi
echo "Verification passed."
