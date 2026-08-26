// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";

interface HealthSnapshot {
  timestamp: number;
  uptime: number;
  memoryUsage: { heapUsed: number; heapTotal: number; rss: number };
  activeConnections: number;
}

export function captureHealthSnapshot(): HealthSnapshot {
  const mem = process.memoryUsage();
  return {
    timestamp: Date.now(),
    uptime: process.uptime(),
    memoryUsage: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss },
    activeConnections: 0,
  };
}

export function formatHealthSnapshot(snapshot: HealthSnapshot): string {
  return [
    `Uptime: ${Math.floor(snapshot.uptime / 3600)}h ${Math.floor((snapshot.uptime % 3600) / 60)}m`,
    `Memory: ${(snapshot.memoryUsage.heapUsed / 1024 / 1024).toFixed(1)}MB used`,
  ].join(" | ");
}

/** Log the current memory usage for periodic health checks. */
export function logMemoryUsage(): void {
  const snapshot = captureHealthSnapshot();
  if (snapshot.memoryUsage.heapUsed / snapshot.memoryUsage.heapTotal > 0.8) {
    logger.warn("High memory usage", {
      heapUsed: (snapshot.memoryUsage.heapUsed / 1024 / 1024).toFixed(1) + "MB",
      heapTotal: (snapshot.memoryUsage.heapTotal / 1024 / 1024).toFixed(1) + "MB",
    });
  }
}
