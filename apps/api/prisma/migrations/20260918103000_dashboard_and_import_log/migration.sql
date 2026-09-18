-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('SUCCESS', 'DUPLICATE', 'FAILED');

-- CreateTable
CREATE TABLE "ImportAttempt" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sourceHash" TEXT,
    "status" "ImportStatus" NOT NULL,
    "orderId" TEXT,
    "documentNumber" TEXT,
    "documentDate" DATE,
    "warehouse" TEXT,
    "itemCount" INTEGER,
    "warnings" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportAttempt_status_createdAt_idx" ON "ImportAttempt"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportAttempt_sourceHash_idx" ON "ImportAttempt"("sourceHash");

-- CreateIndex
CREATE INDEX "ImportAttempt_orderId_idx" ON "ImportAttempt"("orderId");

-- AddForeignKey
ALTER TABLE "ImportAttempt" ADD CONSTRAINT "ImportAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
