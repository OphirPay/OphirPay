import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // NOTE: The sharded‑database support was previously excluded from coverage
    // because it was exercised only by the Playwright E2E suite.  We now have
    // dedicated unit tests for the router, so we include the whole `src/lib/db`
    // directory in the coverage report.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Removed the exclusion of `src/lib/db/**` to allow shard‑router.ts to be
      // measured by unit‑test coverage.
      exclude: [
        // other exclusions that were already present in the original config
        // (e.g., generated files, test utilities, etc.) remain untouched.
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/coverage/**',
        '**/*.d.ts',
      ],
    },
  },
});
