#!/usr/bin/env python3
"""Patch webhook-deliver.ts to use the shared timeout helper + retry config."""
import re, pathlib, sys

p = pathlib.Path('src/lib/webhook-deliver.ts')
src = p.read_text()
orig = src

# 1. imports
if 'fetch-with-timeout' not in src:
    src = src.replace(
        'import { isSafeWebhookUrlAtDelivery } from "@/lib/webhook-url-guard";',
        'import { isSafeWebhookUrlAtDelivery } from "@/lib/webhook-url-guard";\n'
        'import { fetchWithTimeout } from "@/lib/fetch-with-timeout";\n'
        'import { RETRY_CONFIG } from "@/lib/retry-config";',
        1,
    )

# 2. default retries from central config
src = src.replace(
    '  maxRetries = 3\n)',
    '  maxRetries = RETRY_CONFIG.webhook.maxAttempts\n)',
    1,
)

# 3. swap raw fetch + AbortController for the timeout-enforcing helper
old_block = """      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OphirPay-Signature": signature,
          "X-OphirPay-Event": payload.event,
        },
        body,
        signal: controller.signal,
        redirect: "manual",
      });

      clearTimeout(timeout);
      lastStatusCode = response.status;"""
new_block = """      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-OphirPay-Signature": signature,
            "X-OphirPay-Event": payload.event,
          },
          body,
          redirect: "manual",
        },
        RETRY_CONFIG.webhook.timeoutMs,
      );

      lastStatusCode = response.status;"""
if old_block in src:
    src = src.replace(old_block, new_block, 1)
elif 'fetchWithTimeout(' not in src:
    print('ERROR: could not locate fetch block', file=sys.stderr)
    sys.exit(1)

# 4. exponential backoff capped by central config
src = src.replace(
    'await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000));',
    'const backoffMs = Math.min(\n'
    '        Math.pow(2, attempt - 1) * RETRY_CONFIG.webhook.baseDelayMs,\n'
    '        RETRY_CONFIG.webhook.maxDelayMs,\n'
    '      );\n'
    '      await new Promise((r) => setTimeout(r, backoffMs));',
    1,
)

if src == orig:
    print('ERROR: no changes applied', file=sys.stderr)
    sys.exit(1)

p.write_text(src)
print('patched webhook-deliver.ts')
