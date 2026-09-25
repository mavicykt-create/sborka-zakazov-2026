CREATE TYPE "EmailOrderStatus" AS ENUM ('RECEIVED', 'IMPORTED', 'DUPLICATE', 'FAILED');

CREATE TABLE "EmailOrderImport" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "messageId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "attachmentId" TEXT,
    "attachmentName" TEXT NOT NULL,
    "attachmentHash" TEXT,
    "status" "EmailOrderStatus" NOT NULL DEFAULT 'RECEIVED',
    "orderId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOrderImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOrderImport_sourceKey_key" ON "EmailOrderImport"("sourceKey");
CREATE INDEX "EmailOrderImport_status_receivedAt_idx" ON "EmailOrderImport"("status", "receivedAt");
CREATE INDEX "EmailOrderImport_messageId_idx" ON "EmailOrderImport"("messageId");
CREATE INDEX "EmailOrderImport_orderId_idx" ON "EmailOrderImport"("orderId");

ALTER TABLE "EmailOrderImport"
ADD CONSTRAINT "EmailOrderImport_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
