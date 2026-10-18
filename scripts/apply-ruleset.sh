#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Apply or update the branch protection ruleset via GitHub API.

set -euo pipefail

RULESET_FILE=".github/rulesets/protected-branches.json"
REPO="${GITHUB_REPOSITORY:-OphirPay/OphirPay}"
DRY_RUN=false
VERIFY_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    --verify)
      VERIFY_ONLY=true
      ;;
    --help)
      echo "Usage: $0 [--dry-run] [--verify]"
      exit 0
      ;;
  esac
done

if [ ! -f "$RULESET_FILE" ]; then
  echo "Error: Ruleset definition not found at $RULESET_FILE" >&2
  exit 1
fi

# Validate JSON format
if ! jq empty "$RULESET_FILE" 2>/dev/null; then
  echo "Error: $RULESET_FILE is not valid JSON" >&2
  exit 1
fi

echo "Validating ruleset configuration for ${REPO}..."
RULESET_NAME=$(jq -r '.name' "$RULESET_FILE")
echo "Target ruleset: ${RULESET_NAME}"

if [ "$VERIFY_ONLY" = true ]; then
  echo "Verification mode: ruleset JSON is valid and formatted correctly."
  exit 0
fi

if [ "$DRY_RUN" = true ]; then
  echo "Dry-run mode: would deploy ruleset payload to repos/${REPO}/rulesets"
  jq . "$RULESET_FILE"
  exit 0
fi

# Check authentication
if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required to apply the ruleset" >&2
  exit 1
fi

echo "Checking existing rulesets on ${REPO}..."
EXISTING_ID=$(gh api "repos/${REPO}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id" 2>/dev/null || true)

if [ -n "$EXISTING_ID" ]; then
  echo "Updating existing ruleset ID ${EXISTING_ID}..."
  gh api --method PUT "repos/${REPO}/rulesets/${EXISTING_ID}" --input "$RULESET_FILE" >/dev/null
  echo "Successfully updated ruleset '${RULESET_NAME}' (ID: ${EXISTING_ID})."
else
  echo "Creating new ruleset '${RULESET_NAME}'..."
  gh api --method POST "repos/${REPO}/rulesets" --input "$RULESET_FILE" >/dev/null
  echo "Successfully created ruleset '${RULESET_NAME}'."
fi
