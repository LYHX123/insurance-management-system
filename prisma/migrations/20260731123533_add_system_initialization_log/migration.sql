-- CreateEnum
CREATE TYPE "SystemInitializationStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "SystemInitializationLog" (
    "id" TEXT NOT NULL,
    "executedByUserId" TEXT NOT NULL,
    "executedByNameSnapshot" TEXT NOT NULL,
    "status" "SystemInitializationStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "deletedCounts" JSONB,
    "preservedCountsBefore" JSONB,
    "preservedCountsAfter" JSONB,
    "errorSummary" TEXT,
    "appVersion" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemInitializationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemInitializationLog_status_idx" ON "SystemInitializationLog"("status");

-- CreateIndex
CREATE INDEX "SystemInitializationLog_startedAt_idx" ON "SystemInitializationLog"("startedAt");
