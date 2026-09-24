# Webhook Verification

OphirPay signs every outgoing webhook request with an HMAC‑SHA256
signature using the secret you provide when creating a webhook subscription.
The signature is sent in the `X-Ophirpay-Signature` header.

## Verifying the signature

