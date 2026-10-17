#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Pre-commit secret scan (issue #1398).
#
# Runs gitleaks over the *staged* changes and fails the commit when a value in
# the OphirPay .gitleaks.toml rule set (default rules + a strict Stellar `S…`
# secret-seed rule) is found. This is the local counterpart to the CI
# `secrets-scan` job, so a seed phrase or live key is caught before it is ever
# pushed — not after it is in the branch's history.
#
# Enable it once with `npm run prepare` (see CONTRIBUTING.md).
#
# Exit codes:
#   0  no finding (or gitleaks is not installed — see the warning)
#   1  gitleaks flagged the staged changes; the commit is blocked
#
# Deliberately non-blocking when gitleaks is absent: forcing every contributor
# to install a binary before their first commit is hostile, and CI still scans.
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${REPO_ROOT}" ]; then
  echo "[secrets] Not inside a git work tree — skipping." >&2
  exit 0
fi
cd "${REPO_ROOT}"

CONFIG=".gitleaks.toml"
if [ ! -f "${CONFIG}" ]; then
  echo "[secrets] ${CONFIG} not found — skipping (expected at the repo root)." >&2
  exit 0
fi

# Nothing staged → nothing to scan.
if git diff --cached --quiet; then
  exit 0
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "[secrets] ⚠️  gitleaks is not installed — skipping the pre-commit scan."
  echo "          Install it to catch secrets before they reach a branch:"
  echo "            macOS:  brew install gitleaks"
  echo "            other:  https://github.com/gitleaks/gitleaks/releases"
  echo "          CI still scans every PR; this hook is a faster local gate."
  exit 0
fi

# gitleaks renamed `protect --staged` to `git --staged` in v8.19.0 (the old
# spelling still works but is hidden). Pick the right one from the version so a
# newer local install and the version pinned in CI both work.
#
# NOTE: probing with `gitleaks help <cmd>` does NOT work — cobra's `help` exits
# 0 for an unknown subcommand, so it would select `git` on 8.18.4, where that
# command does not exist, and block every clean commit.
GITLEAKS_VERSION="$(gitleaks version 2>/dev/null | head -n1 | tr -d 'v\r')"
GITLEAKS_MAJOR="${GITLEAKS_VERSION%%.*}"
GITLEAKS_REST="${GITLEAKS_VERSION#*.}"
GITLEAKS_MINOR="${GITLEAKS_REST%%.*}"
if [ "${GITLEAKS_MAJOR:-0}" -gt 8 ] 2>/dev/null ||
   { [ "${GITLEAKS_MAJOR:-0}" -eq 8 ] 2>/dev/null && [ "${GITLEAKS_MINOR:-0}" -ge 19 ] 2>/dev/null; }; then
  GITLEAKS_SCAN=(git --staged)
else
  # Unparseable version falls back to the spelling pinned in CI (v8.18.4).
  GITLEAKS_SCAN=(protect --staged)
fi

echo "[secrets] 🔒 Scanning staged changes with gitleaks…"

set +e
gitleaks "${GITLEAKS_SCAN[@]}" --config "${CONFIG}" --redact --verbose
STATUS=$?
set -e

if [ "${STATUS}" -eq 0 ]; then
  exit 0
fi

cat >&2 <<'EOF'

[secrets] ❌ gitleaks flagged a potential secret in your staged changes —
          the commit was blocked.

          • Never commit a real key or seed. Remove it, rotate the credential,
            and re-stage.
          • If this is a documented, non-sensitive demo value, add it to the
            `[allowlist]` in .gitleaks.toml (with a reason) or its path to
            `paths`.
          • The same scan runs in CI (`secrets-scan`), so bypassing the hook
            with `--no-verify` will still fail the PR.
EOF
exit 1
