// SPDX-License-Identifier: MIT

import { PrismaClient, Prisma } from "@prisma/client";
import { registerShutdownHook, setupSignalHandlers } from "./lifecycle";

export { Prisma };

const prismaClientSingleton = () => {
  return new PrismaClient();
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaDisconnecting?: boolean;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Gracefully disconnect the Prisma client and release database connection pools.
 */
export async function disconnectPrisma(): Promise<void> {
  if (globalForPrisma.prismaDisconnecting) {
    return;
  }
  globalForPrisma.prismaDisconnecting = true;

  console.log(
    JSON.stringify({
      level: "info",
      event: "prisma:teardown:start",
      timestamp: new Date().toISOString(),
      message: "[prisma] Disconnecting Prisma database client...",
    })
  );

  try {
    await prisma.$disconnect();
    console.log(
      JSON.stringify({
        level: "info",
        event: "prisma:teardown:complete",
        timestamp: new Date().toISOString(),
        message: "[prisma] Prisma database client disconnected successfully.",
      })
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "prisma:teardown:error",
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
        message: "[prisma] Error occurred while disconnecting Prisma client.",
      })
    );
  } finally {
    globalForPrisma.prismaDisconnecting = false;
  }
}

// Register database teardown in centralized lifecycle shutdown hooks (priority 5)
registerShutdownHook("prisma", disconnectPrisma, 5);

// Install signal handlers for SIGTERM and SIGINT on runtime bootstrap
setupSignalHandlers();
