# Stellar Wallets Integration Guide

OphirPay provides a unified multi-wallet connector abstraction (`MultiWalletProvider`) that connects the frontend application to Stellar wallets for key management and transaction signing.

---

## 1. Wallet Status & Overview

| Wallet | Connector ID | Type | Supported Platforms | Status |
|---|---|---|---|---|
| **Freighter** | `freighter` | Browser Extension | Chrome, Firefox, Edge, Brave | ✅ **Active** (Recommended) |
| **Albedo** | `albedo` | Web-based Popup | Desktop & Mobile (no install needed) | ✅ **Active** |
| **xBull** | `xbull` | Extension / Web | Desktop & Mobile | ✅ **Active** |
| **Rabet** | `rabet` | Browser Extension | Desktop | ✅ **Active** |
| **Lobstr** | `lobstr` | Web / Mobile (SEP-7) | Mobile app & Web | ✅ **Active** |
| **Ledger** | `ledger` | Hardware Wallet (WebUSB) | Chromium-based browsers only | ⏳ **Pending Integration** |

---

## 2. Connector Architecture

Wallet connectors implement the `WalletConnector` interface defined in `src/lib/wallets/types.ts`:

```typescript
export interface WalletConnector {
  id: WalletId;
  name: string;
  description: string;
  icon: string;
  isAvailable(): boolean;
  connect(): Promise<{ publicKey: string; network: string }>;
  disconnect(): Promise<void>;
  signTransaction(xdr: string, opts?: SignOptions): Promise<string>;
  signMessage?(message: string): Promise<string>;
  getAddress(): Promise<string | null>;
  getNetwork(): Promise<string | null>;
  isConnected(): Promise<boolean>;
}
```

The UI registry in `WALLET_REGISTRY` tags each connector with `supported: boolean` and `status: "supported" | "pending" | "unsupported"`. The `WalletSelector` modal only presents supported connectors so users are never prompted with connectors that fail or throw on connect.

---

## 3. Hardware Wallets: Ledger Status & Technical Requirements

### Current Status: Pending Integration
The Ledger connector (`src/lib/wallets/ledger.ts`) is currently stubbed and marked as `supported: false` in `WALLET_REGISTRY`. Its `isAvailable()` method returns `false` to ensure it is not offered in the connect modal until the required hardware driver packages are installed and tested.

### Dependencies Required for Full Integration
To enable on-device signing via Ledger:
- `@ledgerhq/hw-transport-webusb`: WebUSB transport layer for communicating with Ledger devices.
- `@ledgerhq/hw-app-str`: Official Ledger Stellar application protocol client.

### Browser & Protocol Requirements
- **WebUSB API**: Ledger communication in web browsers requires WebUSB (`navigator.usb`).
- **Chromium Browsers Only**: WebUSB is supported in Google Chrome, Microsoft Edge, Brave, and Opera.
- **Unsupported Browsers**: Firefox and Apple Safari do not support the WebUSB specification due to vendor security policies.
- **Secure Context (HTTPS)**: WebUSB requires a secure context (`window.isSecureContext`).
- **Device Requirements**: The Ledger device (Nano S, Nano S Plus, Nano X, or Stax) must be unlocked with the Stellar app opened.

### Fallback Guidance
Users seeking hardware-grade security can use Freighter or xBull configured with their hardware wallet bridges, or use software-based signing with Freighter or Albedo directly.

---

## 4. Developer Usage

```tsx
import { useWallet } from "@/hooks/useMultiWallet";

export function SendButton() {
  const { wallet, connect, disconnect } = useWallet();

  if (!wallet.connected) {
    return <button onClick={() => connect("freighter")}>Connect Wallet</button>;
  }

  return <div>Connected as: {wallet.publicKey}</div>;
}
```
