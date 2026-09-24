import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    env: {
      NEXT_PUBLIC_CONTRACT_ID: "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET",
      NEXT_PUBLIC_EMITTER_CONTRACT_ID: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
      NEXT_PUBLIC_CHAIN_READ_SOURCE: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
    },
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/components/ui/**", "src/hooks/**", "src/app/api/**"],
      exclude: [
        // Test suite files and TypeScript declaration files
        "src/__tests__/**",
        "src/types/**",
        "**/*.d.ts",
        // Browser wallet extension integration modules
        "src/lib/wallets/**",
        // Library & component barrel re-export index files
        "src/lib/index.ts",
        "src/components/ui/index.ts",
        "src/hooks/index.ts",
        // Soroban smart contract & Stellar RPC infrastructure
        "src/lib/contracts.ts",
        "src/lib/contract-advanced.ts",
        "src/lib/contract-events.ts",
        "src/lib/stellar.ts",
        "src/lib/rpc-failover.ts",
        "src/lib/deploy-verify.ts",
        "src/lib/trustline.ts",
        // Event streaming & delivery subsystems
        "src/lib/events/event-source.ts",
        "src/lib/api-auth.ts",
        "src/lib/api-client.ts",
        "src/lib/rate-limit.ts",
        "src/lib/webhook-dispatcher.ts",
        "src/lib/webhook-deliver.ts",
        // Database fixture modules tested via E2E Playwright suite
        "src/lib/db/**",
        // Server initialization, instrumentation & Sentry setup
        "src/instrumentation.ts",
        "src/lib/startup.ts",
        "src/lib/demo-mode.ts",
        "src/lib/sentry.ts",
        // React UI hooks exercised via browser integration tests
        "src/hooks/useMultiWallet.tsx",
        "src/hooks/useFreighter.tsx",
        "src/hooks/useTheme.tsx",
        "src/hooks/useRetry.ts",
        "src/hooks/useApiQuery.ts",
        "src/hooks/useNetworkChange.ts",
        "src/hooks/useErrorTracker.ts",
        "src/hooks/useKeyboardShortcuts.ts",
        "src/hooks/useLocalStorage.ts",
        // Utility helpers & feature flag modules
        "src/lib/ab-test.ts",
        "src/lib/address-book.ts",
        "src/lib/api-cache.ts",
        "src/lib/audit.ts",
        "src/lib/batch-validator.ts",
        "src/lib/chart-data.ts",
        "src/lib/client-auth.ts",
        "src/lib/client-version.ts",
        "src/lib/csv-import.ts",
        "src/lib/payment-link.ts",
        "src/lib/prisma-logger.ts",
        "src/lib/query-params.ts",
        "src/lib/soft-delete.ts",
        "src/lib/test-factory.ts",
        "src/lib/time.ts",
        "src/lib/version-script.ts",
        "src/lib/web-vitals.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
