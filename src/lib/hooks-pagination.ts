// SPDX-License-Identifier: MIT

/**
 * Page size for the notification-hook list (`GET /api/hooks`).
 *
 * Mirrors the on-chain subscriber-hook reader. It lives here rather than in
 * the route module because a Next.js `route.ts` may only export HTTP method
 * handlers and the reserved route-segment config; an extra export fails the
 * stricter webpack build's generated type check (and is required by
 * `scripts/check-bundle-budget.mjs`, which builds with webpack).
 */
export const HOOK_PAGE_LIMIT = 50;
