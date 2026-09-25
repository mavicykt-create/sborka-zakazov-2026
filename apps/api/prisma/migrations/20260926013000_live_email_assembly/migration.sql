ALTER TYPE "EmailOrderStatus" ADD VALUE 'UPDATED';

ALTER TABLE "Order" ADD COLUMN "orderTotal" DECIMAL(14,2);
ALTER TABLE "EmailOrderImport" ADD COLUMN "orderTotal" DECIMAL(14,2);

CREATE INDEX "Order_sourceSystem_updatedAt_idx" ON "Order"("sourceSystem", "updatedAt");
