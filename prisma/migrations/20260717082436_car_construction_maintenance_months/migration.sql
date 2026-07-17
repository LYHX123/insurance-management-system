-- AlterTable
ALTER TABLE "CarSectionDetail" ADD COLUMN     "constructionPeriodMonths" INTEGER,
ADD COLUMN     "maintenancePeriodMonths" INTEGER,
ALTER COLUMN "contractPeriodFrom" DROP NOT NULL,
ALTER COLUMN "contractPeriodTo" DROP NOT NULL;
