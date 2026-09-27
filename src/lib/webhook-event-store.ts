// SPDX-License-Identifier: MIT
//
// COMPATIBILITY SHIM — the implementation moved to
// `src/lib/webhooks/persistence.ts` and `src/lib/webhooks/replay.ts`
// (issue #758). New code should import from `@/lib/webhooks`.

export * from "./webhooks/persistence";
export * from "./webhooks/replay";
