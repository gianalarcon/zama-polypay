-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "accountAddress" TEXT NOT NULL,
    "propId" INTEGER NOT NULL,
    "commitment" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vote_accountAddress_propId_idx" ON "Vote"("accountAddress", "propId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_accountAddress_propId_commitment_key" ON "Vote"("accountAddress", "propId", "commitment");
