// SPDX-License-Identifier: MIT

import { PrismaClient, Prisma } from "@prisma/client";
import { registerPrismaClient, registerShutdownHandlers } from "@/lib/lifecycle";

export { Prisma };

const prismaClientSingleton = () => {
  return new PrismaClient();
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

// Register Prisma client for graceful SIGTERM/SIGINT disconnection (#1311).
registerPrismaClient(prisma);

if (process.env.NODE_ENV === "production") {
  registerShutdownHandlers();
} else {
  globalForPrisma.prisma = prisma;
}

export default prisma;
