// SPDX-License-Identifier: MIT

/**
 * Next.js instrumentation hook — runs once on server startup.
 * Validates environment, initializes rate-limit store, and logs config.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register() {
  // Only run on server startup, not during build or client-side
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrap } = await import("@/lib/startup");
    await bootstrap();
  }
}
