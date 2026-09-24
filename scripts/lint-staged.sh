#!/usr/bin/env bash
# This script runs linting and formatting checks on staged files.
# It uses `git diff --cached --name-only --diff-filter=ACM` to get the list of staged files.
# Only files that match the patterns in the lint-staged config are checked.

set -euo pipefail

# Get staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
  echo "No staged files to lint."
  exit 0
fi

# Run lint-staged via npm script
# This will use the configuration in package.json
npx lint-staged
