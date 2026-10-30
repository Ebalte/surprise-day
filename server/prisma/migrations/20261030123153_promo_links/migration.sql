-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cosmetics" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "petOutfit" TEXT,
ADD COLUMN     "roomTheme" TEXT;

-- CreateTable
CREATE TABLE "promo_links" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "pack" TEXT NOT NULL,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_claims" (
    "id" SERIAL NOT NULL,
    "promoId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_links_code_key" ON "promo_links"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_claims_promoId_userId_key" ON "promo_claims"("promoId", "userId");

-- AddForeignKey
ALTER TABLE "promo_claims" ADD CONSTRAINT "promo_claims_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "promo_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_claims" ADD CONSTRAINT "promo_claims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
