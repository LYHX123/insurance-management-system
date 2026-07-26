-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MotorClaimNature" AS ENUM ('OWN_DAMAGE', 'THIRD_PARTY_CLAIM', 'WINDSCREEN', 'ACCIDENT');

-- CreateEnum
CREATE TYPE "MotorClaimProgress" AS ENUM ('PREPARE_CLAIM_DOCUMENT', 'ASSESSMENT_PROCESS', 'APPROVAL_AND_REPAIR', 'RE_INSPECTION_AND_RELEASE', 'FINISH');

-- CreateEnum
CREATE TYPE "NonMotorClaimProgress" AS ENUM ('DOCUMENT_PREPARATION', 'LOSS_ASSESSMENT_INVESTIGATION', 'APPROVAL', 'DV_ISSUED', 'PAYMENT', 'FINISH');

-- CreateTable
CREATE TABLE "MotorClaimNumberCounter" (
    "yearMonth" TEXT NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MotorClaimNumberCounter_pkey" PRIMARY KEY ("yearMonth")
);

-- CreateTable
CREATE TABLE "NonMotorClaimNumberCounter" (
    "yearMonth" TEXT NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NonMotorClaimNumberCounter_pkey" PRIMARY KEY ("yearMonth")
);

-- CreateTable
CREATE TABLE "MotorClaim" (
    "id" TEXT NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "numberPlate" TEXT NOT NULL,
    "claimNature" "MotorClaimNature" NOT NULL,
    "progress" "MotorClaimProgress" NOT NULL DEFAULT 'PREPARE_CLAIM_DOCUMENT',
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "MotorClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonMotorClaim" (
    "id" TEXT NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "insuranceType" "NonMotorCoverType" NOT NULL,
    "progress" "NonMotorClaimProgress" NOT NULL DEFAULT 'DOCUMENT_PREPARATION',
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "NonMotorClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MotorClaim_claimNumber_key" ON "MotorClaim"("claimNumber");

-- CreateIndex
CREATE INDEX "MotorClaim_status_idx" ON "MotorClaim"("status");

-- CreateIndex
CREATE INDEX "MotorClaim_reportedAt_idx" ON "MotorClaim"("reportedAt");

-- CreateIndex
CREATE INDEX "MotorClaim_customerId_idx" ON "MotorClaim"("customerId");

-- CreateIndex
CREATE INDEX "MotorClaim_deletedAt_idx" ON "MotorClaim"("deletedAt");

-- CreateIndex
CREATE INDEX "MotorClaim_numberPlate_idx" ON "MotorClaim"("numberPlate");

-- CreateIndex
CREATE UNIQUE INDEX "NonMotorClaim_claimNumber_key" ON "NonMotorClaim"("claimNumber");

-- CreateIndex
CREATE INDEX "NonMotorClaim_status_idx" ON "NonMotorClaim"("status");

-- CreateIndex
CREATE INDEX "NonMotorClaim_reportedAt_idx" ON "NonMotorClaim"("reportedAt");

-- CreateIndex
CREATE INDEX "NonMotorClaim_customerId_idx" ON "NonMotorClaim"("customerId");

-- CreateIndex
CREATE INDEX "NonMotorClaim_deletedAt_idx" ON "NonMotorClaim"("deletedAt");

-- AddForeignKey
ALTER TABLE "MotorClaim" ADD CONSTRAINT "MotorClaim_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonMotorClaim" ADD CONSTRAINT "NonMotorClaim_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
