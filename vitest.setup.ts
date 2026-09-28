import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { resetReadCache } from "@/lib/api-cache";
import { resetFeeStatsCache } from "@/lib/fee-stats";

// The read cache (#741) is process-global by design — that is what makes it
// useful in production and a cross-test leak in a test run. Reset it before
// every test so a cached payload from one case can never satisfy another.
beforeEach(async () => {
  await resetReadCache();
  // Same reasoning for the Horizon fee-statistics cache (#825): a cached
  // sample from one case must not drive another case's recommended fee.
  //
  // NOTE: keep this module free of a static import of `@/lib/stellar` (as
  // `@/lib/asset-metadata` has): setup files run *before* a test file's
  // `vi.mock` calls are applied, so pulling the SDK in here would defeat the
  // per-file mocks in stellar-*.test.ts. The asset-metadata cache is reset in
  // its own suite instead.
  resetFeeStatsCache();
});

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
};

const storageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: storageMock,
  writable: true,
  configurable: true,
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: storageMock,
    writable: true,
    configurable: true,
  });
}
