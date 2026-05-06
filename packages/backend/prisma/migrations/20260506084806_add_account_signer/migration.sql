-- CreateTable
CREATE TABLE "AccountSigner" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "name" TEXT,
    "ownerIndex" INTEGER NOT NULL,
    "isCreator" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountSigner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountSigner_commitment_idx" ON "AccountSigner"("commitment");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSigner_accountId_commitment_key" ON "AccountSigner"("accountId", "commitment");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSigner_accountId_ownerIndex_key" ON "AccountSigner"("accountId", "ownerIndex");

-- AddForeignKey
ALTER TABLE "AccountSigner" ADD CONSTRAINT "AccountSigner_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
