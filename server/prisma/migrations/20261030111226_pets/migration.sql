-- AlterTable
ALTER TABLE "users" ADD COLUMN     "activePet" TEXT,
ADD COLUMN     "coins" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "gameBest" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "petFood" JSONB NOT NULL DEFAULT '{"berry":3,"cookie":1}';

-- CreateTable
CREATE TABLE "pets" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "figureCode" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "food" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "mood" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "clean" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "energy" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "asleep" BOOLEAN NOT NULL DEFAULT false,
    "last" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ageMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activeSince" TIMESTAMP(3),
    "stage" INTEGER NOT NULL DEFAULT 0,
    "lastPatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_runs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "game" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "score" INTEGER,
    "coins" INTEGER,

    CONSTRAINT "game_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pets_userId_figureCode_key" ON "pets"("userId", "figureCode");

-- CreateIndex
CREATE INDEX "game_runs_userId_startedAt_idx" ON "game_runs"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_runs" ADD CONSTRAINT "game_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
