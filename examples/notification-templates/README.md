# OphirPay Slack & Discord Notification Templates

Ready-made payload adapters and templates for broadcasting OphirPay payment and lifecycle events to Slack channels and Discord servers.

---

## ⚠️ Security Notice: Relay Requirement

> **CRITICAL:** Slack and Discord incoming webhooks **do not verify HMAC-SHA256 signatures**.
>
> If you point an OphirPay webhook subscription directly to a Slack or Discord incoming webhook URL:
> 1. Anyone on the internet who discovers or brute-forces your webhook URL can forge payment alerts into your private channels.
> 2. Signature verification headers will be ignored by Slack/Discord.
>
> **Solution:** You must run the lightweight [Relay Adapter](relay-adapter.ts) (or an equivalent serverless function). The relay verifies the `X-OphirPay-Signature` header using your webhook secret, applies your event filter, and formats the message before forwarding to Slack/Discord.

---

## Files Included

- [`relay-adapter.ts`](relay-adapter.ts) — Full verification, event-filtering, and payload formatting adapter.
- [`slack-sample.json`](slack-sample.json) — Working Slack Block Kit payload example.
- [`discord-sample.json`](discord-sample.json) — Working Discord Rich Embed payload example.

---

## Quick Setup

### 1. Deploy Relay Function
Run `relay-adapter.ts` on Vercel Edge, AWS Lambda, or Cloudflare Workers.

### 2. Configure Environment
Set `OPHIRPAY_WEBHOOK_SECRET` and your `SLACK_WEBHOOK_URL` or `DISCORD_WEBHOOK_URL`.

### 3. Subscribe in OphirPay Dashboard
Register the URL of your relay in **OphirPay Settings -> Webhooks** and select only the events you want your channel to receive (e.g. `payment.confirmed`, `payment.failed`, `batch.completed`).
