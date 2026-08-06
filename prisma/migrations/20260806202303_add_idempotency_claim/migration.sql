-- CreateTable
CREATE TABLE "IdempotencyClaim" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyClaim_key_key" ON "IdempotencyClaim"("key");

-- CreateIndex
CREATE INDEX "IdempotencyClaim_scope_createdAt_idx" ON "IdempotencyClaim"("scope", "createdAt");
