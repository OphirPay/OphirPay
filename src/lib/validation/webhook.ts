// SPDX-License-Identifier: MIT

/**
 * Webhook registration URL protocol validation (issue #1954).
 *
 * Enforces HTTPS protocol for all user-registered webhook destination URLs in
 * non-development environments. Plain HTTP endpoints transmit secret HMAC
 * signatures and sensitive transaction payloads in cleartext, exposing them
 * to interception or eavesdropping over public networks.
 *
 * In local development (`NODE_ENV === 'development'`), `http://localhost` and
 * loopback endpoints are permitted to facilitate local testing and mocking.
 */

import { z } from "zod";

/**
 * Validate that a webhook destination URL uses the permitted protocol:
 * - In non-development mode (production/test/staging): strictly `https:`.
 * - In development mode: `https:` OR `http://` targeting localhost or loopback (127.0.0.1, [::1]).
 */
export function isAllowedWebhookProtocol(
  urlString: string,
  env: string = process.env.NODE_ENV || "development"
): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol === "https:") {
      return true;
    }

    if (parsed.protocol === "http:") {
      if (env === "development") {
        const host = parsed.hostname.toLowerCase();
        return (
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "[::1]" ||
          host === "::1"
        );
      }
      return false;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Zod schema enforcing HTTPS protocol on webhook callback URLs.
 */
export const webhookUrlSchema = z
  .string()
  .url("Invalid webhook URL")
  .refine(
    (url) => isAllowedWebhookProtocol(url, process.env.NODE_ENV),
    {
      message:
        process.env.NODE_ENV === "development"
          ? "Webhook URL must use https:// protocol (or http://localhost in development)"
          : "Webhook destination URL must use the https:// protocol in production",
    }
  );

/**
 * Schema for creating a new webhook subscription.
 */
export const createWebhookSchema = z.object({
  url: webhookUrlSchema,
  events: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
