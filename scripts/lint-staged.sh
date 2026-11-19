#!/bin/bash
# Pre-commit lint-staged script (opt-in, heavier than the default hook).
# The committed pre-commit hook runs scripts/pre-commit-secrets.sh. To also run
# the full typecheck/lint/test gate before committing, enable this via
# `git config core.hooksPath .githooks` and calling it from .githooks/pre-commit.

echo "🔍 Running pre-commit checks..."

# TypeScript check
echo "  → TypeScript..."
npx tsc --noEmit || { echo "❌ TypeScript errors found"; exit 1; }

# Lint (flat config — `next lint` was removed in Next.js 16)
echo "  → Lint..."
npx eslint . --max-warnings 0 || { echo "⚠️  Lint warnings (non-blocking)"; }

# Tests
echo "  → Tests..."
npx vitest run --reporter=verbose || { echo "❌ Tests failed"; exit 1; }

echo "✅ All pre-commit checks passed!"
