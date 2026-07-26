-- CreateEnum
CREATE TYPE "NonMotorCoverType" AS ENUM ('CONTRACTORS_ALL_RISKS', 'WIBA', 'EMPLOYERS_LIABILITY', 'CONTRACTORS_PLANT_MACHINERY', 'PUBLIC_LIABILITY', 'FIRE_ALLIED_PERILS', 'BURGLARY', 'GOODS_IN_TRANSIT_SINGLE', 'GOODS_IN_TRANSIT_ANNUAL', 'MARINE', 'GROUP_PERSONAL_ACCIDENT', 'GROUP_MEDICAL');

-- CreateTable
CREATE TABLE "NonMotorPolicyDetail" (
    "id" TEXT NOT NULL,
    "policyRecordId" TEXT NOT NULL,
    "insuranceType" "NonMotorCoverType" NOT NULL,
    "policyNumber" TEXT,

    CONSTRAINT "NonMotorPolicyDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NonMotorPolicyDetail_policyRecordId_key" ON "NonMotorPolicyDetail"("policyRecordId");

-- CreateIndex
CREATE INDEX "NonMotorPolicyDetail_insuranceType_idx" ON "NonMotorPolicyDetail"("insuranceType");

-- AddForeignKey
ALTER TABLE "NonMotorPolicyDetail" ADD CONSTRAINT "NonMotorPolicyDetail_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
