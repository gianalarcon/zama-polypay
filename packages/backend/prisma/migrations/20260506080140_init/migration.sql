-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT,
    "threshold" INTEGER NOT NULL,
    "ownersCount" INTEGER NOT NULL,
    "chainId" INTEGER NOT NULL DEFAULT 11155111,
    "contractVersion" TEXT NOT NULL DEFAULT 'polypay-zama-v1',
    "deployTxHash" TEXT,
    "initTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_address_key" ON "Account"("address");
