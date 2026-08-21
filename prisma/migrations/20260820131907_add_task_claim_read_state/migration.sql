-- CreateTable
CREATE TABLE "TaskReadState" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskReadState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotorClaimReadState" (
    "id" TEXT NOT NULL,
    "motorClaimId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MotorClaimReadState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonMotorClaimReadState" (
    "id" TEXT NOT NULL,
    "nonMotorClaimId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NonMotorClaimReadState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskReadState_userId_idx" ON "TaskReadState"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskReadState_taskId_userId_key" ON "TaskReadState"("taskId", "userId");

-- CreateIndex
CREATE INDEX "MotorClaimReadState_userId_idx" ON "MotorClaimReadState"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MotorClaimReadState_motorClaimId_userId_key" ON "MotorClaimReadState"("motorClaimId", "userId");

-- CreateIndex
CREATE INDEX "NonMotorClaimReadState_userId_idx" ON "NonMotorClaimReadState"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NonMotorClaimReadState_nonMotorClaimId_userId_key" ON "NonMotorClaimReadState"("nonMotorClaimId", "userId");

-- AddForeignKey
ALTER TABLE "TaskReadState" ADD CONSTRAINT "TaskReadState_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotorClaimReadState" ADD CONSTRAINT "MotorClaimReadState_motorClaimId_fkey" FOREIGN KEY ("motorClaimId") REFERENCES "MotorClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonMotorClaimReadState" ADD CONSTRAINT "NonMotorClaimReadState_nonMotorClaimId_fkey" FOREIGN KEY ("nonMotorClaimId") REFERENCES "NonMotorClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
