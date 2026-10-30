-- CreateTable
CREATE TABLE "story_images" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_images_userId_createdAt_idx" ON "story_images"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "story_images_createdAt_idx" ON "story_images"("createdAt");

-- AddForeignKey
ALTER TABLE "story_images" ADD CONSTRAINT "story_images_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
