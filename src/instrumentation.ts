// SPDX-License-Identifier: MIT

/**
 * Next.js instrumentation hook — runs once on server startup.
 * Validates environment, initializes rate-limit store, logs config, and
 * starts the optional WebSocket event server (SSE remains the fallback).
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register() {
  // Only run on server startup, not during build or client-side
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { bootstrap } = await import("@/lib/startup");
    await bootstrap();

    // Start the WebSocket event channel (lower-latency alternative to SSE).
    // Failures are non-fatal: clients automatically fall back to /api/events.
    try {
      const { startLiveEventsWsServer } = await import(
        "@/lib/events/live-events-ws-server"
      );
      const wsServer = await startLiveEventsWsServer();
      wsServer.startEventStream();
      console.info(
        `[OphirPay] WebSocket event server listening on port ${wsServer.port}`
      );
    } catch (error) {
      console.warn(
        "[OphirPay] WebSocket event server unavailable — clients will use SSE:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
