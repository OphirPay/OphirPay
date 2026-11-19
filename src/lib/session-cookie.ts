// SPDX-License-Identifier: MIT

/**
 * Name of the signed browser session cookie.
 *
 * Kept in its own dependency-free module so edge code (`src/proxy.ts`,
 * `src/lib/csrf-token.ts`) can read it without importing the Prisma-backed
 * session module.
 */
export const SESSION_COOKIE_NAME = "ophirpay_session";
