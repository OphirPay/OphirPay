# Ledger Hardware Wallet Connector

## Overview
OphirPay provides hardware-grade signing security through the **Ledger** wallet connector (`src/lib/wallets/ledger.ts`), supporting Ledger Nano S, Nano S Plus, and Nano X devices running the official Stellar app.

Communication is handled directly within the browser via **WebUSB**, eliminating the need for third-party browser extensions or bridge software.

## Technical Architecture

### 1. Libraries & Dependencies
- `@ledgerhq/hw-transport-webusb`: Direct browser-to-hardware communication via the WebUSB API.
- `@ledgerhq/hw-app-str`: Official Ledger application wrapper for the Stellar app.
- `@stellar/stellar-sdk`: Transaction decoding, `signatureBase()` computation, signature hint decoration, and envelope reconstruction.

### 2. BIP-44 Derivation Path
In accordance with SEP-0005, Stellar accounts on Ledger utilize the standardized BIP-44 path:
```
44'/148'/0'
```
Where:
- `44'`: BIP-44 purpose
- `148'`: Stellar Lumens registered coin type
- `0'`: Default account index

### 3. Browser Compatibility & Availability
WebUSB requires:
- A Chromium-based browser: Google Chrome, Microsoft Edge, Brave, or Opera.
- A Secure Context (`window.isSecureContext === true`, i.e., HTTPS or `localhost`).

Browsers lacking WebUSB support (e.g., Firefox, Safari, iOS WebKit) are detected via `isAvailable()`. The connector is excluded from `getAvailableWallets()`, ensuring unsupported platforms do not display non-functional hardware wallet prompts.

### 4. Actionable Error Mapping
Ledger communication returns specific APDU response codes and WebUSB exceptions that are translated into clear, actionable guidance:

| Error Condition | APDU / Exception | User-Facing Guidance |
|---|---|---|
| **WebUSB Missing** | `!navigator.usb` | *"WebUSB is not supported in this browser. Please use Chrome, Edge, Brave, or Opera over HTTPS."* |
| **Cancelled Prompt** | `NotFoundError` | *"No Ledger device was selected. Please plug in your Ledger, unlock it with your PIN, and try again."* |
| **Interface Busy** | `0x6800`, `0x6801` | *"Unable to connect to Ledger. Ensure Ledger Live or other wallet applications are closed, then try again."* |
| **Device Locked** | `0x5515`, `0x6982` | *"Your Ledger device is locked. Please unlock it with your PIN and open the Stellar app."* |
| **App Not Open** | `0x6e00`, `0x6700`, `CLA_NOT_SUPPORTED` | *"The Stellar app is not open on your Ledger device. Please open the Stellar app from the Ledger dashboard and try again."* |
| **User Rejection** | `0x6985`, `CONDITIONS_OF_USE_NOT_SATISFIED` | *"Operation was rejected on your Ledger device."* |

## Testing
- Unit tests in `src/__tests__/ledger-wallet.test.ts` verify WebUSB availability gating, BIP-44 derivation path validation, error parsing, connection lifecycle, and transaction XDR signing.
