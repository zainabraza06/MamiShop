-- CreateEnum
CREATE TYPE "CustomRequestStatus" AS ENUM ('OPEN', 'QUOTED', 'ACCEPTED', 'ORDERED', 'DECLINED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageAuthorRole" AS ENUM ('CUSTOMER', 'STAFF', 'SYSTEM');

-- CreateTable
CREATE TABLE "custom_requests" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "template" "SizingTemplate",
    "measurementProfileId" TEXT,
    "measurementUnit" "MeasurementUnit",
    "measurementSnapshot" JSONB,
    "budget" INTEGER,
    "neededBy" TIMESTAMP(3),
    "status" "CustomRequestStatus" NOT NULL DEFAULT 'OPEN',
    "unreadByStaff" BOOLEAN NOT NULL DEFAULT true,
    "unreadByCustomer" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_request_messages" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorRole" "MessageAuthorRole" NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_request_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_requests_number_key" ON "custom_requests"("number");

-- CreateIndex
CREATE INDEX "custom_requests_userId_lastMessageAt_idx" ON "custom_requests"("userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "custom_requests_status_lastMessageAt_idx" ON "custom_requests"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "custom_requests_unreadByStaff_status_idx" ON "custom_requests"("unreadByStaff", "status");

-- CreateIndex
CREATE INDEX "custom_request_messages_requestId_createdAt_idx" ON "custom_request_messages"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_measurementProfileId_fkey" FOREIGN KEY ("measurementProfileId") REFERENCES "measurement_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_request_messages" ADD CONSTRAINT "custom_request_messages_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "custom_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_request_messages" ADD CONSTRAINT "custom_request_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
