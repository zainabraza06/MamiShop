-- CreateEnum
CREATE TYPE "CustomQuoteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "custom_request_messages" ADD COLUMN     "quoteId" TEXT;

-- CreateTable
CREATE TABLE "custom_quotes" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "stitchingDays" INTEGER NOT NULL,
    "note" TEXT,
    "status" "CustomQuoteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_quotes_orderId_key" ON "custom_quotes"("orderId");

-- CreateIndex
CREATE INDEX "custom_quotes_requestId_createdAt_idx" ON "custom_quotes"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "custom_request_messages" ADD CONSTRAINT "custom_request_messages_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "custom_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_quotes" ADD CONSTRAINT "custom_quotes_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "custom_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_quotes" ADD CONSTRAINT "custom_quotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_quotes" ADD CONSTRAINT "custom_quotes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
