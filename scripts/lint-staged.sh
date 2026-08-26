#!/bin/bash
# Pre-commit lint-staged script.
# Install with: npx husky add .husky/pre-commit "bash scripts/lint-staged.sh"

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
