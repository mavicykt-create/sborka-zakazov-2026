CREATE TYPE "ProblemResolution" AS ENUM ('CONFIRMED', 'RESOLVED');

ALTER TYPE "EventType" ADD VALUE 'ITEM_REVIEWED';
ALTER TYPE "EventType" ADD VALUE 'PROBLEM_CONFIRMED';
ALTER TYPE "EventType" ADD VALUE 'PROBLEM_RETURNED';
ALTER TYPE "EventType" ADD VALUE 'ORDER_CLOSED';

ALTER TABLE "Order" ADD COLUMN "closedAt" TIMESTAMP(3);

ALTER TABLE "OrderItem"
ADD COLUMN "problemResolution" "ProblemResolution",
ADD COLUMN "reviewComment" TEXT,
ADD COLUMN "reviewedBy" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "Order_status_closedAt_idx" ON "Order"("status", "closedAt");
CREATE INDEX "OrderItem_problemResolution_status_idx" ON "OrderItem"("problemResolution", "status");
