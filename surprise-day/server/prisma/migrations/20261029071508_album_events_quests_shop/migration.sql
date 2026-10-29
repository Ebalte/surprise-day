-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DropSource" ADD VALUE 'ALBUM_ROW';
ALTER TYPE "DropSource" ADD VALUE 'EVENT_REWARD';
ALTER TYPE "DropSource" ADD VALUE 'AD';
ALTER TYPE "DropSource" ADD VALUE 'PURCHASE';

-- AlterTable
ALTER TABLE "figures" ADD COLUMN     "eventSlug" TEXT;

-- AlterTable
ALTER TABLE "user_badges" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'badge';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "activeFrame" TEXT,
ADD COLUMN     "streakFreezeWeek" TEXT;

-- CreateTable
CREATE TABLE "user_rewards" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_quests" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "weekKey" TEXT NOT NULL,
    "questCode" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "user_quests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "telegramChargeId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_rewards_userId_seasonId_code_key" ON "user_rewards"("userId", "seasonId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "user_quests_userId_weekKey_questCode_key" ON "user_quests"("userId", "weekKey", "questCode");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_telegramChargeId_key" ON "purchases"("telegramChargeId");

-- CreateIndex
CREATE INDEX "purchases_userId_createdAt_idx" ON "purchases"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "figures_seasonId_eventSlug_idx" ON "figures"("seasonId", "eventSlug");

-- AddForeignKey
ALTER TABLE "user_rewards" ADD CONSTRAINT "user_rewards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quests" ADD CONSTRAINT "user_quests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
