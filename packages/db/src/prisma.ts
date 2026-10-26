import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/prisma/client.js";

export { Prisma };

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? (
  process.env.DATABASE_URL
    ? createPrismaClient()
    : new Proxy({} as PrismaClient, {
      get() {
        throw new Error("DATABASE_URL is required.");
      }
    })
);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
