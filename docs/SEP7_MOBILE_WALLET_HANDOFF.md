# SEP-7 Mobile Wallet Handoff in OphirPay

OphirPay implements the [SEP-0007](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md) Stellar URI standard (`web+stellar:pay`) to enable seamless payment handoff between web applications and mobile Stellar wallets.

---

## 1. Overview & Problem Solved

On desktop browsers, users typically approve Stellar transactions using browser extension wallets (such as Freighter, xBull, or Albedo).

On mobile devices:
- Browser extensions are unavailable in standard mobile browsers (Safari, Chrome for Android).
- Mobile users cannot complete web-based wallet extension transactions.
- **SEP-7** (`web+stellar:pay`) solves this by defining a standardized custom URI scheme that mobile wallets register with the mobile operating system (iOS Universal Links, Android App Links, and custom URI schemes).
- Tapping **"Open in Wallet"** launches the user's installed mobile Stellar wallet with payment details pre-filled.

---

## 2. SEP-7 URI Grammar & Parameters

The generated URI adheres to the official SEP-7 specification:

```
web+stellar:pay?destination=<account>&amount=<amount>&asset_code=<code>&asset_issuer=<issuer>&memo=<memo>&memo_type=<type>&msg=<message>
```

### Parameters Carried

| Parameter | Type | Required? | Description |
|---|---|---|---|
| `destination` | Stellar Address (`G...`) or Federation (`*`) | **Yes** | Destination account receiving the payment. |
| `amount` | Decimal String (e.g. `25.50`) | Optional | Payment amount. Up to 7 decimal places. |
| `asset_code` | Alphanumeric (1–12 chars) | Optional | Asset code. Per SEP-7, omitted for native XLM. |
| `asset_issuer` | Stellar Address (`G...`) | Optional | Required if `asset_code` is non-native. |
| `memo` | String | Optional | Transaction memo. |
| `memo_type` | `MEMO_TEXT` \| `MEMO_ID` \| `MEMO_HASH` \| `MEMO_RETURN` | Optional | Memo type. Defaults to `MEMO_TEXT` (max 28 bytes UTF-8). |
| `msg` | String (max 300 chars) | Optional | Human-readable note shown to the sender in wallet UI. |
| `network_passphrase` | String | Optional | Stellar network passphrase (omitted uses wallet default). |
| `callback` | URL (`url:...`) | Optional | Webhook callback URL after signing. |

---

## 3. Supported Mobile Wallets

The following mobile Stellar wallets support SEP-7 protocol handling:

1. **Lobstr Wallet** (iOS & Android):
   - Supports `web+stellar:pay` and QR code scanning.
   - Website: [https://lobstr.co](https://lobstr.co)
2. **Solar Wallet** (iOS, Android, Desktop):
   - Full native SEP-7 and multi-signature support.
   - Website: [https://solarwallet.io](https://solarwallet.io)
3. **Beans App** (iOS & Android):
   - Zero-fee cross-currency payments and SEP-7 support.
   - Website: [https://www.beansapp.com](https://www.beansapp.com)
4. **Decaf Wallet** (iOS & Android):
   - Global Stellar consumer wallet supporting SEP-7.
   - Website: [https://www.decaf.so](https://www.decaf.so)
5. **Vibrant** (iOS & Android):
   - Focused on digital dollar (USDC) savings and payments.
   - Website: [https://vibrantapp.com](https://vibrantapp.com)

---

## 4. User Experience & Browser Fallback Flow

### On Mobile Devices
1. The user navigates to a payment link (e.g. `/pay/[address]?amount=25&memo=invoice-101`).
2. OphirPay displays the **"Open in Wallet"** primary action button.
3. Tapping the button launches the installed wallet app via the `web+stellar:pay` protocol handler.
4. If the user prefers to scan using another device or if the app does not launch automatically, a **"Show QR Code"** toggle is available.

### On Desktop / Unsupported Browsers (Fallback)
1. If the browser does not have a registered SEP-7 handler (or on desktop), OphirPay displays the QR code prominently.
2. An explanatory message informs the user:
   > *"If your browser does not support custom protocol handlers, scan the QR code using your phone camera or Stellar wallet app (Lobstr, Solar, Beans, Decaf)."*
3. The user can also:
   - Click **"Pay with OphirPay Web App"** to use their connected desktop browser extension (Freighter, xBull, Albedo).
   - Click **"Copy SEP-7 URI"** to paste into wallets that support manual URI import.

---

## 5. Round-Trip Verification & Tests

OphirPay guarantees full round-trip fidelity between SEP-7 URI generation and link parsing:

```ts
import { generateSep7PaymentUri, parsePaymentLink } from "@/lib/payment-link";

const original = {
  destination: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
  amount: "50.00",
  memo: "order-9988",
  memoType: "MEMO_TEXT",
  assetCode: "USDC",
  assetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  message: "Monthly subscription",
};

// 1. Generate SEP-7 URI
const uri = generateSep7PaymentUri(original);

// 2. Parse back through payment link parser
const parsed = parsePaymentLink(uri);

// 3. Every field round-trips exactly
assert.deepStrictEqual(parsed, original);
```
