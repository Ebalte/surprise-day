/**
 * Покупка яиц за Telegram Stars.
 * Цена растёт с каждой покупкой (25 → 50 → 100) и сбрасывается, когда игрок открывает новое яйцо дня.
 * Счёт выставляет игровой бот (createInvoiceLink, валюта XTR), яйцо выдаётся только после successful_payment.
 */
import type { Api } from "grammy";
import type { User } from "@prisma/client";
import { prisma } from "../db.js";
import { GameError, addGrants, loadSeason } from "./core.js";

type Payload = { u: number; c: number; n: number; p: number };

const cycleStart = (user: Pick<User, "lastFreeEggAt">) => user.lastFreeEggAt ?? new Date(0);

export async function shopState(user: User) {
  const { rules } = await loadSeason();
  const prices = rules.shop.eggPricesStars;
  const used = await prisma.purchase.count({ where: { userId: user.id, createdAt: { gte: cycleStart(user) } } });
  return { prices, used, left: Math.max(0, prices.length - used), nextPrice: used < prices.length ? prices[used] : null };
}

export async function createEggInvoice(api: Api, user: User) {
  const s = await shopState(user);
  if (s.nextPrice == null) throw new GameError("shop_limit", `Все ${s.prices.length} яйца куплены. Цена сбросится с новым яйцом дня`);
  const payload: Payload = { u: user.id, c: cycleStart(user).getTime(), n: s.used, p: s.nextPrice };
  let link: string;
  try {
    link = await api.createInvoiceLink(
      "Бонусное яйцо",
      `Покупка ${s.used + 1} из ${s.prices.length} до следующего яйца дня. Шансы как у обычного яйца.`,
      JSON.stringify(payload),
      "", // для Stars provider_token пустой
      "XTR",
      [{ label: "Яйцо", amount: s.nextPrice }],
    );
  } catch (e) {
    console.error("[shop] createInvoiceLink", e);
    throw new GameError("invoice_failed", "Telegram не выдал счёт. Попробуйте через минуту", 502);
  }
  return { link, price: s.nextPrice, number: s.used + 1, of: s.prices.length };
}

/** pre_checkout_query: счёт ещё актуален? (цена не сменилась, не куплено параллельно) */
export async function validateCheckout(rawPayload: string, totalAmount: number, telegramId: number): Promise<string | null> {
  let p: Payload;
  try { p = JSON.parse(rawPayload); } catch { return "Неизвестный счёт"; }
  const user = await prisma.user.findUnique({ where: { id: p.u } });
  if (!user || Number(user.telegramId) !== telegramId) return "Счёт выставлен другому игроку";
  if (user.isBanned) return "Аккаунт заблокирован";
  if (cycleStart(user).getTime() !== p.c) return "Цена уже сбросилась. Откройте магазин ещё раз";
  const s = await shopState(user);
  if (s.used !== p.n || s.nextPrice !== p.p || totalAmount !== p.p) return "Цена изменилась. Откройте магазин ещё раз";
  return null;
}

/** successful_payment: записываем платёж и выдаём яйцо. Повторное уведомление о том же платеже ничего не даст. */
export async function fulfillPayment(rawPayload: string, chargeId: string, stars: number) {
  const p = JSON.parse(rawPayload) as Payload;
  return prisma.$transaction(async (tx) => {
    const exists = await tx.purchase.findUnique({ where: { telegramChargeId: chargeId } });
    if (exists) return { duplicate: true as const, userId: p.u };
    await tx.purchase.create({ data: { userId: p.u, telegramChargeId: chargeId, stars, payload: rawPayload } });
    await addGrants(tx, p.u, [{ source: "PURCHASE", dedupeKey: `purchase:${chargeId}` }]);
    return { duplicate: false as const, userId: p.u };
  });
}
