-- CreateEnum
CREATE TYPE "AdPlacement" AS ENUM ('REWARDED', 'BANNER');

-- AlterEnum
ALTER TYPE "DropSource" ADD VALUE 'ADMIN';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isBanned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ad_campaigns" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "placement" "AdPlacement" NOT NULL,
    "text" TEXT NOT NULL,
    "mediaFileId" TEXT,
    "mediaType" TEXT,
    "buttonText" TEXT,
    "url" TEXT,
    "durationSec" INTEGER NOT NULL DEFAULT 5,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "maxImpressions" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "completions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdBy" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_views" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),

    CONSTRAINT "ad_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "admin_log" (
    "id" SERIAL NOT NULL,
    "adminId" BIGINT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_campaigns_placement_isActive_idx" ON "ad_campaigns"("placement", "isActive");

-- CreateIndex
CREATE INDEX "ad_views_userId_startedAt_idx" ON "ad_views"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "admin_log_createdAt_idx" ON "admin_log"("createdAt");

-- AddForeignKey
ALTER TABLE "ad_views" ADD CONSTRAINT "ad_views_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
