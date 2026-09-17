-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OFF_SHIFT', 'AVAILABLE', 'BUSY');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('ORDER_ASSIGNED', 'ORDER_STARTED', 'ORDER_COMPLETED', 'ITEM_ASSIGNED', 'ITEM_REASSIGNED', 'ITEM_ACTIVE', 'ITEM_PICKED', 'ITEM_NOT_FOUND', 'ITEM_SKIPPED', 'ITEM_UNDONE');

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "assignedAt" TIMESTAMP(3),
ADD COLUMN "assignedWorkerId" TEXT;

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "shiftStatus" "ShiftStatus" NOT NULL DEFAULT 'OFF_SHIFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT,
    "workerId" TEXT,
    "type" "EventType" NOT NULL,
    "serverAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Worker_login_key" ON "Worker"("login");

-- CreateIndex
CREATE INDEX "Worker_isActive_shiftStatus_idx" ON "Worker"("isActive", "shiftStatus");

-- CreateIndex
CREATE INDEX "OrderItem_assignedWorkerId_status_idx" ON "OrderItem"("assignedWorkerId", "status");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_serverAt_idx" ON "OrderEvent"("orderId", "serverAt");

-- CreateIndex
CREATE INDEX "OrderEvent_itemId_serverAt_idx" ON "OrderEvent"("itemId", "serverAt");

-- CreateIndex
CREATE INDEX "OrderEvent_workerId_serverAt_idx" ON "OrderEvent"("workerId", "serverAt");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_assignedWorkerId_fkey" FOREIGN KEY ("assignedWorkerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
