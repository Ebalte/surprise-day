-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedBy" BIGINT;
