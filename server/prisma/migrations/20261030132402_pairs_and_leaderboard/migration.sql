-- AlterTable
ALTER TABLE "game_runs" ADD COLUMN     "pairId" INTEGER;

-- AlterTable
ALTER TABLE "pets" ADD COLUMN     "lastNotifyAt" TIMESTAMP(3),
ADD COLUMN     "notified" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "petNotify" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "pairs" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'couple',
    "ownerId" INTEGER NOT NULL,
    "partnerId" INTEGER,
    "inviteCode" TEXT NOT NULL,
    "petId" INTEGER NOT NULL,
    "careStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),

    CONSTRAINT "pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pair_days" (
    "id" SERIAL NOT NULL,
    "pairId" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "ownerCared" BOOLEAN NOT NULL DEFAULT false,
    "partnerCared" BOOLEAN NOT NULL DEFAULT false,
    "ownerPoints" INTEGER NOT NULL DEFAULT 0,
    "partnerPoints" INTEGER NOT NULL DEFAULT 0,
    "teamRewarded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pair_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet_log" (
    "id" SERIAL NOT NULL,
    "petId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pairs_inviteCode_key" ON "pairs"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "pairs_petId_key" ON "pairs"("petId");

-- CreateIndex
CREATE INDEX "pairs_ownerId_idx" ON "pairs"("ownerId");

-- CreateIndex
CREATE INDEX "pairs_partnerId_idx" ON "pairs"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "pair_days_pairId_day_key" ON "pair_days"("pairId", "day");

-- CreateIndex
CREATE INDEX "pet_log_petId_createdAt_idx" ON "pet_log"("petId", "createdAt");

-- CreateIndex
CREATE INDEX "game_runs_game_finishedAt_idx" ON "game_runs"("game", "finishedAt");

-- CreateIndex
CREATE INDEX "pets_activeSince_idx" ON "pets"("activeSince");

-- AddForeignKey
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pair_days" ADD CONSTRAINT "pair_days_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_log" ADD CONSTRAINT "pet_log_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_log" ADD CONSTRAINT "pet_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
