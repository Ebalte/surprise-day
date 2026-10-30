/**
 * Стили питомца: наряды и оформление комнаты. Выдаются ссылками-подарками из админ-бота.
 * Новый набор: добавьте предметы в OUTFITS/ROOMS (и их вид в web/src/pet), а набор — в PROMO_PACKS.
 */
import { randomBytes } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "../db.js";
import { GameError, lockUsers } from "./core.js";

export const OUTFITS: Record<string, string> = { metal: "Косуха металлиста" };
export const ROOMS: Record<string, string> = { metal: "Комната металлиста" };
export const PROMO_PACKS: Record<string, { title: string; items: string[] }> = {
  metal: { title: "Набор «Металлист» 🤘", items: ["outfit:metal", "room:metal"] },
};

export const cosmeticsOf = (u: User) => u.cosmetics as string[];
export const cosmeticsState = (u: User) => ({ owned: cosmeticsOf(u), outfit: u.petOutfit, room: u.roomTheme });

/** Надеть наряд / оформить комнату (null — снять). Только то, что уже получено. */
export async function setStyle(userId: number, outfit: string | null, room: string | null) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const owned = cosmeticsOf(u);
  if (outfit && !owned.includes(`outfit:${outfit}`)) throw new GameError("not_owned", "Этого наряда у вас нет");
  if (room && !owned.includes(`room:${room}`)) throw new GameError("not_owned", "Такого оформления у вас нет");
  await prisma.user.update({ where: { id: userId }, data: { petOutfit: outfit, roomTheme: room } });
  return { outfit, room };
}

export const newPromoCode = () => randomBytes(5).toString("hex");

/** Получить подарок по ссылке: каждый игрок один раз, всего не больше maxUses раз */
export async function claimPromo(userId: number, code: string) {
  return prisma.$transaction(async (tx) => {
    const [promo] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM promo_links WHERE code = ${code} FOR UPDATE`;
    if (!promo) throw new GameError("no_promo", "Ссылка-подарок не найдена", 404);
    const p = await tx.promoLink.findUniqueOrThrow({ where: { id: promo.id } });
    const pack = PROMO_PACKS[p.pack];
    if (!pack) throw new GameError("no_promo", "Ссылка-подарок не найдена", 404);
    if (await tx.promoClaim.findUnique({ where: { promoId_userId: { promoId: p.id, userId } } })) {
      throw new GameError("promo_claimed", "Вы уже получили этот подарок", 409);
    }
    if (!p.isActive) throw new GameError("promo_off", "Эта ссылка-подарок больше не действует", 410);
    if (p.maxUses != null && p.uses >= p.maxUses) throw new GameError("promo_empty", "Подарки по этой ссылке уже разобрали", 410);
    await lockUsers(tx, userId);
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const owned = [...new Set([...cosmeticsOf(u), ...pack.items])];
    const outfit = pack.items.find((i) => i.startsWith("outfit:"))?.slice(7);
    const room = pack.items.find((i) => i.startsWith("room:"))?.slice(5);
    await tx.promoClaim.create({ data: { promoId: p.id, userId } });
    await tx.promoLink.update({ where: { id: p.id }, data: { uses: { increment: 1 } } });
    // Подарок сразу надеваем — чтобы игрок увидел его
    await tx.user.update({ where: { id: userId }, data: { cosmetics: owned, petOutfit: outfit ?? u.petOutfit, roomTheme: room ?? u.roomTheme } });
    return { pack: p.pack, title: pack.title, items: pack.items };
  });
}
