CREATE TYPE "McpAccessLevel" AS ENUM ('READ', 'READ_WRITE');

CREATE TABLE "McpAccessToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accessLevel" "McpAccessLevel" NOT NULL DEFAULT 'READ',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "McpAccessToken_tokenPrefix_key" ON "McpAccessToken"("tokenPrefix");
CREATE UNIQUE INDEX "McpAccessToken_tokenHash_key" ON "McpAccessToken"("tokenHash");
CREATE INDEX "McpAccessToken_revokedAt_createdAt_idx" ON "McpAccessToken"("revokedAt", "createdAt");
CREATE INDEX "McpAccessToken_lastUsedAt_idx" ON "McpAccessToken"("lastUsedAt");
