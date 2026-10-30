-- AlterEnum
ALTER TYPE "DropSource" ADD VALUE 'STORY';

-- AlterTable
ALTER TABLE "game_runs" ADD COLUMN     "record" BOOLEAN NOT NULL DEFAULT false;
