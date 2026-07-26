-- AlterTable
ALTER TABLE "MotorClaim" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "NonMotorClaim" ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "MotorClaimParticipant" (
    "id" TEXT NOT NULL,
    "motorClaimId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT NOT NULL,

    CONSTRAINT "MotorClaimParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonMotorClaimParticipant" (
    "id" TEXT NOT NULL,
    "nonMotorClaimId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT NOT NULL,

    CONSTRAINT "NonMotorClaimParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotorClaimUpdate" (
    "id" TEXT NOT NULL,
    "motorClaimId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isInitial" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "MotorClaimUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonMotorClaimUpdate" (
    "id" TEXT NOT NULL,
    "nonMotorClaimId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isInitial" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "NonMotorClaimUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MotorClaimParticipant_userId_idx" ON "MotorClaimParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MotorClaimParticipant_motorClaimId_userId_key" ON "MotorClaimParticipant"("motorClaimId", "userId");

-- CreateIndex
CREATE INDEX "NonMotorClaimParticipant_userId_idx" ON "NonMotorClaimParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NonMotorClaimParticipant_nonMotorClaimId_userId_key" ON "NonMotorClaimParticipant"("nonMotorClaimId", "userId");

-- CreateIndex
CREATE INDEX "MotorClaimUpdate_motorClaimId_idx" ON "MotorClaimUpdate"("motorClaimId");

-- CreateIndex
CREATE INDEX "MotorClaimUpdate_createdAt_idx" ON "MotorClaimUpdate"("createdAt");

-- CreateIndex
CREATE INDEX "MotorClaimUpdate_deletedAt_idx" ON "MotorClaimUpdate"("deletedAt");

-- CreateIndex
CREATE INDEX "NonMotorClaimUpdate_nonMotorClaimId_idx" ON "NonMotorClaimUpdate"("nonMotorClaimId");

-- CreateIndex
CREATE INDEX "NonMotorClaimUpdate_createdAt_idx" ON "NonMotorClaimUpdate"("createdAt");

-- CreateIndex
CREATE INDEX "NonMotorClaimUpdate_deletedAt_idx" ON "NonMotorClaimUpdate"("deletedAt");

-- CreateIndex
CREATE INDEX "MotorClaim_projectId_idx" ON "MotorClaim"("projectId");

-- CreateIndex
CREATE INDEX "NonMotorClaim_projectId_idx" ON "NonMotorClaim"("projectId");

-- AddForeignKey
ALTER TABLE "MotorClaim" ADD CONSTRAINT "MotorClaim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CustomerProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonMotorClaim" ADD CONSTRAINT "NonMotorClaim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CustomerProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotorClaimParticipant" ADD CONSTRAINT "MotorClaimParticipant_motorClaimId_fkey" FOREIGN KEY ("motorClaimId") REFERENCES "MotorClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonMotorClaimParticipant" ADD CONSTRAINT "NonMotorClaimParticipant_nonMotorClaimId_fkey" FOREIGN KEY ("nonMotorClaimId") REFERENCES "NonMotorClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotorClaimUpdate" ADD CONSTRAINT "MotorClaimUpdate_motorClaimId_fkey" FOREIGN KEY ("motorClaimId") REFERENCES "MotorClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonMotorClaimUpdate" ADD CONSTRAINT "NonMotorClaimUpdate_nonMotorClaimId_fkey" FOREIGN KEY ("nonMotorClaimId") REFERENCES "NonMotorClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
