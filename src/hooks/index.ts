// SPDX-License-Identifier: MIT

export { MultiWalletProvider as WalletProvider, useWallet } from "./useMultiWallet";
export { getFreighter as getFreighterLegacy } from "./useFreighter";
export { useTheme } from "./useTheme";
export { useDebounce } from "./useDebounce";
export { usePagination } from "./usePagination";
export { useOnClickOutside } from "./useOnClickOutside";
export { useLocalStorage } from "./useLocalStorage";
export { useMediaQuery } from "./useMediaQuery";
export { useRetry } from "./useRetry";
export { useWindowSize } from "./useWindowSize";
export { useCountdown } from "./useCountdown";
export { useNetworkChange, useNetworkPoller } from "./useNetworkChange";
export {
  useRpcHealth,
  formatRpcEndpoint,
  parseRpcHealthPayload,
  RPC_HEALTH_LATENCY_THRESHOLD_MS,
} from "./useRpcHealth";
export type {
  RpcHealthStatus,
  RpcHealthSnapshot,
  RpcHealthProbe,
  UseRpcHealthOptions,
} from "./useRpcHealth";
export { useErrorTracker } from "./useErrorTracker";
export { useCopyToClipboard } from "./useCopyToClipboard";
export { useIsMounted, useMountedRef } from "./useIsMounted";
export { usePrevious } from "./usePrevious";
export { useKeyboardShortcuts } from "./useKeyboardShortcuts";
export { useNotifications } from "./useNotifications";
export { useFormSubmit, useFormReset } from "@/lib/form-helpers";
export { useXlmPrice } from "./usePrice";
export { useCurrencyDisplay } from "./useCurrencyDisplay";
export type { DisplayCurrency } from "./useCurrencyDisplay";
