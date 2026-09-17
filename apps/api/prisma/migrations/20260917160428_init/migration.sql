-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'READY', 'ASSIGNED', 'PICKING', 'REVIEW_REQUIRED', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PickType" AS ENUM ('PACKAGE', 'PIECE', 'REVIEW');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('PENDING', 'ASSIGNED', 'ACTIVE', 'PICKED', 'NOT_FOUND', 'SKIPPED');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentDate" DATE NOT NULL,
    "warehouse" TEXT NOT NULL,
    "sourceHash" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sourceLine" INTEGER NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "packageQuantity" DECIMAL(14,3),
    "pieceQuantity" DECIMAL(14,3),
    "pickType" "PickType" NOT NULL,
    "pickQuantity" DECIMAL(14,3) NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'PENDING',
    "sortIndex" INTEGER NOT NULL,
    "pickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_sourceHash_key" ON "Order"("sourceHash");

-- CreateIndex
CREATE UNIQUE INDEX "Order_documentNumber_documentDate_warehouse_key" ON "Order"("documentNumber", "documentDate", "warehouse");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_sortIndex_idx" ON "OrderItem"("orderId", "sortIndex");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_groupKey_idx" ON "OrderItem"("orderId", "groupKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_sourceLine_key" ON "OrderItem"("orderId", "sourceLine");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
