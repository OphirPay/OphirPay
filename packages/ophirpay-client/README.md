# @ophirpay/client

A small, dependency-free client for the [OphirPay](https://github.com/OphirPay/OphirPay)
payments API. Its operation catalogue is **generated from the committed
[`docs/openapi.yaml`](../../docs/openapi.yaml)**, so the client and the
published spec cannot drift.

## Install

The package is published from this repository. From a checkout:

```bash
npm install ./packages/ophirpay-client
```

## Use

```js
import { OphirPayClient } from "@ophirpay/client";

const client = new OphirPayClient({
  baseUrl: "https://api.ophirpay.com",
  apiKey: process.env.OPHIRPAY_API_KEY,
});

const payment = await client.createPayment({
  recipient: "G...",
  amount: 25,
  assetCode: "XLM",
});

const batch = await client.createBatch({ recipients: [/* … */] });
const status = await client.getPayment(payment.id);
```

`baseUrl` defaults to `OPHIRPAY_BASE_URL` (or `http://localhost:3000`) and
`apiKey` to `OPHIRPAY_API_KEY`, so CI only needs to set the environment.

## Webhook verification

`verifyWebhookSignature` mirrors the server's scheme — HMAC-SHA256 over
`<timestamp>.<body without the signature field>` — and enforces a replay
tolerance window:

```js
import { verifyWebhookSignature } from "@ophirpay/client";

const ok = verifyWebhookSignature({
  rawBody: req.rawBody,                                  // exactly as received
  signature: req.headers["x-ophirpay-signature"],
  timestamp: req.headers["x-ophirpay-timestamp"],
  secret: process.env.OPHIRPAY_WEBHOOK_SECRET,
});
```

## Regenerating the catalogue

```bash
npm run client:generate   # rewrite operations.generated.{js,d.ts}
npm run client:check      # fail if the committed output is stale (CI)
```

## Versioning

The client tracks the API's `info.version`. A breaking change to a path or
payload ships as a new major of the API and of the client; deprecated
operations stay documented in the spec and callable from the previous client
minor for at least one release cycle.
