ALTER TYPE "OrderStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "EventType" ADD VALUE 'SOURCE_UPDATED';
ALTER TYPE "EventType" ADD VALUE 'SOURCE_CANCELLED';

ALTER TABLE "Order"
ADD COLUMN "sourceSystem" TEXT,
ADD COLUMN "sourceId" TEXT,
ADD COLUMN "sourceRevision" TEXT,
ADD COLUMN "sourceCustomer" TEXT,
ADD COLUMN "sourcePosted" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "Order_sourceSystem_sourceId_key" ON "Order"("sourceSystem", "sourceId");
