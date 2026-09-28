# SEP-24 Anchor Integration (Fiat On/Off-Ramp)

OphirPay can hand a user off to a Stellar **anchor** to move between fiat money
and on-chain assets. The mechanism is [SEP-24][sep24] — an *interactive* deposit
and withdrawal protocol — and it lives in [`src/lib/sep24.ts`](../src/lib/sep24.ts).

Nothing about a specific anchor is hardcoded. The anchor's domain is
configuration and every endpoint is read from the anchor's own
[SEP-1][sep1] `stellar.toml`.

[sep24]: https://stellar.org/protocol/sep-24
[sep1]: https://stellar.org/protocol/sep-1

## What this app does — and does not do

| Concern | Who owns it |
| ------- | ----------- |
| Taking/verifying identity documents (**KYC/AML**) | **The anchor** |
| Holding fiat (bank rail, card, wire) | **The anchor** |
| Sanctions screening, licensing, travel rule | **The anchor** |
| Discovering the anchor and opening its interactive session | This app |
| Polling the transaction to completion and showing state | This app |
| Signing the resulting Stellar payment | The user's wallet |

**OphirPay never holds fiat and never performs KYC.** It opens the anchor's
hosted interactive URL (a new window or an iframe, per the anchor's
requirements) and reflects the resulting Stellar transaction in the UI. The
anchor is the regulated counterparty; this app is a client of it.

## Configuration

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `NEXT_PUBLIC_ANCHOR_DOMAIN` | `testanchor.stellar.org` | Anchor whose `stellar.toml` is fetched |
| `NEXT_PUBLIC_ANCHOR_FIAT_CURRENCY` | `USD` | Fiat currency shown to the user |
| `ANCHOR_METADATA_TTL_MS` | `300000` | How long the parsed TOML is cached |
| `ANCHOR_POLL_INTERVAL_MS` | `5000` | Poll interval for transaction status |
| `ANCHOR_POLL_TIMEOUT_MS` | `600000` | Budget before polling gives up |

The default points at SDF's testnet anchor so the flow can be exercised end to
end without real money. Point it at a production anchor only after reviewing the
anchor's terms and your own compliance posture.

## The flow

1. **Discover.** `fetchAnchorMetadata(domain)` fetches and parses
   `https://<domain>/.well-known/stellar.toml`, prefers
   `TRANSFER_SERVER_SEP0024` (falling back to the legacy `TRANSFER_SERVER`), and
   caches the result per domain for `ANCHOR_METADATA_TTL_MS`. A TOML that
   advertises no transfer server is an error — we never guess a default.
2. **Start.** `initiateInteractiveFlow({ kind, assetCode, account, amount })`
   `POST`s form-encoded fields to `/transactions/{deposit|withdrawal}/interactive`
   and returns `{ url, id }`.
3. **Interact.** The app opens `url` for the user. KYC and the fiat leg happen
   there, on the anchor's pages.
4. **Poll.** `pollAnchorTransaction({ transferServer, id })` polls
   `/transaction?id=…` on the configured interval until the status is terminal,
   reporting each update through `onUpdate`. `mapAnchorStatus()` collapses the
   SEP-24 status vocabulary into `pending | completed | refunded | failed` for
   the UI.
5. **Reflect.** A `completed` deposit/withdrawal carries a
   `stellar_transaction_id` the payment list can show; a `refunded`/`failed`
   terminal state is surfaced as such instead of hanging.

`AnchorError` is thrown for transport/protocol failures and
`AnchorPollTimeoutError` when the budget elapses before a terminal state.

## Security notes

- The anchor endpoints are fetched, not trusted from a URL supplied per
  request, so a crafted link cannot redirect the outbound call.
- Only HTTP(S) is used (`allowHttp: false` on the TOML resolver); the resolved
  domain never receives credentials.
- Servers are addressed over TLS; the SEP-24 transaction id is treated as a
  bearer capability and is not logged.
- SEP-10 (`WEB_AUTH_ENDPOINT`) is surfaced in the metadata for anchors that
  require an authenticated session; the JWT is passed through as a bearer token
  and never persisted.

## Tests

[`src/__tests__/sep24.test.ts`](../src/__tests__/sep24.test.ts) exercises a full
deposit against a fake anchor: TOML discovery, form-encoded initiation, status
polling to completion, a refund terminal state, polling timeout and abort.
