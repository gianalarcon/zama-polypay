-- CreateTable
CREATE TABLE "ProposalExecution" (
    "id" TEXT NOT NULL,
    "accountAddress" TEXT NOT NULL,
    "propId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "blockNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProposalExecution_accountAddress_idx" ON "ProposalExecution"("accountAddress");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalExecution_accountAddress_propId_key" ON "ProposalExecution"("accountAddress", "propId");
