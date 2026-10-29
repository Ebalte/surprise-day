-- CreateEnum
CREATE TYPE "Rarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY');

-- CreateEnum
CREATE TYPE "DropSource" AS ENUM ('DAILY', 'STREAK_BONUS', 'REFERRAL_BONUS', 'FRIENDS_MILESTONE', 'CRAFT');

-- CreateTable
CREATE TABLE "seasons" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL,
    "badgeCode" TEXT NOT NULL,
    "badgeTitle" TEXT NOT NULL,
    "badgeIcon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "figures" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rarity" "Rarity" NOT NULL,
    "image" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "figures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "languageCode" TEXT,
    "photoUrl" TEXT,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "lastFreeEggAt" TIMESTAMP(3),
    "streak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "shards" INTEGER NOT NULL DEFAULT 0,
    "totalEggs" INTEGER NOT NULL DEFAULT 0,
    "firstEggAt" TIMESTAMP(3),
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "eggReadyNotifiedAt" TIMESTAMP(3),
    "botBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_seasons" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "dryStreak" INTEGER NOT NULL DEFAULT 0,
    "eggsOpened" INTEGER NOT NULL DEFAULT 0,
    "uniqueCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "user_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_figures" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "figureId" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstObtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_figures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eggs_log" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "figureId" INTEGER NOT NULL,
    "source" "DropSource" NOT NULL,
    "rarity" "Rarity" NOT NULL,
    "isNew" BOOLEAN NOT NULL,
    "shardsDelta" INTEGER NOT NULL DEFAULT 0,
    "pityApplied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eggs_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "egg_grants" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "source" "DropSource" NOT NULL,
    "minRarity" "Rarity",
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "eggLogId" INTEGER,

    CONSTRAINT "egg_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" SERIAL NOT NULL,
    "inviterId" INTEGER NOT NULL,
    "inviteeId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualifiedAt" TIMESTAMP(3),

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "icon" TEXT,
    "seasonId" INTEGER,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seasons_slug_key" ON "seasons"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_number_key" ON "seasons"("number");

-- CreateIndex
CREATE INDEX "seasons_isActive_idx" ON "seasons"("isActive");

-- CreateIndex
CREATE INDEX "figures_seasonId_rarity_idx" ON "figures"("seasonId", "rarity");

-- CreateIndex
CREATE UNIQUE INDEX "figures_seasonId_code_key" ON "figures"("seasonId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramId_key" ON "users"("telegramId");

-- CreateIndex
CREATE INDEX "users_notificationsEnabled_lastFreeEggAt_idx" ON "users"("notificationsEnabled", "lastFreeEggAt");

-- CreateIndex
CREATE INDEX "user_seasons_seasonId_completedAt_idx" ON "user_seasons"("seasonId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_seasons_userId_seasonId_key" ON "user_seasons"("userId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "user_figures_userId_figureId_key" ON "user_figures"("userId", "figureId");

-- CreateIndex
CREATE INDEX "eggs_log_userId_createdAt_idx" ON "eggs_log"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "eggs_log_seasonId_idx" ON "eggs_log"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "egg_grants_eggLogId_key" ON "egg_grants"("eggLogId");

-- CreateIndex
CREATE INDEX "egg_grants_userId_usedAt_idx" ON "egg_grants"("userId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "egg_grants_userId_dedupeKey_key" ON "egg_grants"("userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_inviteeId_key" ON "referrals"("inviteeId");

-- CreateIndex
CREATE INDEX "referrals_inviterId_qualifiedAt_idx" ON "referrals"("inviterId", "qualifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_userId_code_key" ON "user_badges"("userId", "code");

-- AddForeignKey
ALTER TABLE "figures" ADD CONSTRAINT "figures_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_seasons" ADD CONSTRAINT "user_seasons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_seasons" ADD CONSTRAINT "user_seasons_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_figures" ADD CONSTRAINT "user_figures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_figures" ADD CONSTRAINT "user_figures_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "figures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eggs_log" ADD CONSTRAINT "eggs_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eggs_log" ADD CONSTRAINT "eggs_log_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eggs_log" ADD CONSTRAINT "eggs_log_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "figures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_grants" ADD CONSTRAINT "egg_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "egg_grants" ADD CONSTRAINT "egg_grants_eggLogId_fkey" FOREIGN KEY ("eggLogId") REFERENCES "eggs_log"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
