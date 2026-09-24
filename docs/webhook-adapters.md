# Webhook Payload Adapters for Slack & Discord

OphirPay’s webhook system delivers **PaymentEvent** objects to a URL you
control.  Most DAOs and nonprofits want to push those events into a Slack
or Discord channel so that members can see payments in real‑time.

## Why an adapter is needed

Both Slack and Discord expose **Incoming Webhook** endpoints that accept a
simple JSON payload.  OphirPay, however, signs every webhook request with an
HMAC signature (`X-Ophirpay-Signature`).  Slack and Discord do **not** verify
that signature, which means a malicious third‑party could spoof a request
directly to those services.

**Solution:** run a small relay (e.g. an Express server, Cloudflare Worker,
or serverless function) that:

1. Receives the signed OphirPay webhook.
2. Verifies the HMAC signature using your secret.
3. Transforms the `PaymentEvent` into the appropriate Slack or Discord
   payload using the adapters provided in this repository.
4. Forwards the transformed payload to the Slack/Discord Incoming Webhook
   URL.

## Using the adapters

The adapters live under `src/app/webhooks/adapters/`.

