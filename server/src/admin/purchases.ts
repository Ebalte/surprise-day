/**
 * Покупки за Stars: список, итоги, возврат звёзд игроку.
 * Возврат делает игровой бот (refundStarPayment): звёзды принимал он.
 */
import { GrammyError, InlineKeyboard, type Bot } from "grammy";
import type { Purchase } from "@prisma/client";
import { prisma, startOfUtcDay } from "../db.js";
import { displayName } from "../game/social.js";
import { esc, show, gameApi, type AdminBotOptions, type AdminContext } from "./bot.js";

const fmt = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function totals(since?: Date) {
  const where = { refundedAt: null, ...(since ? { createdAt: { gte: since } } : {}) };
  const r = await prisma.purchase.aggregate({ where, _count: true, _sum: { stars: true } });
  return `${r._count} шт · ${r._sum.stars ?? 0} ⭐`;
}

async function showList(ctx: AdminContext, userId?: number) {
  const list = await prisma.purchase.findMany({
    where: userId ? { userId } : {}, orderBy: { createdAt: "desc" }, take: 15, include: { user: true },
  });
  const kb = new InlineKeyboard();
  for (const p of list) {
    kb.text(`${p.refundedAt ? "↩" : "⭐"} ${p.stars} · ${displayName(p.user)} · ${fmt(p.createdAt)}`.slice(0, 60), `pur:${p.id}`).row();
  }
  kb.text("◀ Меню", "menu");
  let text: string;
  if (userId) {
    const u = list[0]?.user ?? (await prisma.user.findUnique({ where: { id: userId } }));
    text = `<b>Покупки игрока ${esc(u ? displayName(u) : `#${userId}`)}</b>\n${list.length ? "⭐ оплачено · ↩ возвращено" : "Покупок нет."}`;
  } else {
    const [day, week, all, refunded] = await Promise.all([
      totals(startOfUtcDay()), totals(new Date(Date.now() - 7 * 86400_000)), totals(),
      prisma.purchase.aggregate({ where: { refundedAt: { not: null } }, _count: true, _sum: { stars: true } }),
    ]);
    text = [
      "<b>Покупки за Stars</b>",
      `Сегодня: <b>${day}</b>`,
      `За 7 дней: <b>${week}</b>`,
      `Всего: <b>${all}</b>`,
      `Возвращено: ${refunded._count} шт · ${refunded._sum.stars ?? 0} ⭐`,
      "",
      list.length ? "Последние покупки (⭐ оплачено · ↩ возвращено). Нажмите, чтобы открыть:" : "Покупок пока нет.",
    ].join("\n");
  }
  await show(ctx, text, kb);
}

async function eggStatus(p: Purchase) {
  const grant = await prisma.eggGrant.findFirst({ where: { userId: p.userId, dedupeKey: `purchase:${p.telegramChargeId}` }, include: { eggLog: { include: { figure: true } } } });
  if (!grant) return { opened: false, text: p.refundedAt ? "яйцо забрано при возврате" : "яйцо не найдено" };
  if (!grant.usedAt) return { opened: false, text: "яйцо ещё не открыто" };
  return { opened: true, text: `яйцо открыто${grant.eggLog ? `: выпала «${esc(grant.eggLog.figure.name)}»` : ""}` };
}

async function showCard(ctx: AdminContext, id: number, note = "") {
  const p = await prisma.purchase.findUnique({ where: { id }, include: { user: true } });
  if (!p) return showList(ctx);
  const egg = await eggStatus(p);
  const text = [
    note,
    `<b>Покупка #${p.id}</b> · ${p.stars} ⭐`,
    `Игрок: ${esc(displayName(p.user))}${p.user.username ? ` @${esc(p.user.username)}` : ""} · ID <code>${p.user.telegramId}</code>`,
    `Когда: ${fmt(p.createdAt)} (МСК)`,
    `Статус: ${egg.text}`,
    p.refundedAt ? `↩ <b>Звёзды возвращены</b> ${fmt(p.refundedAt)}` : "",
    `Платёж Telegram: <code>${esc(p.telegramChargeId)}</code>`,
  ].filter(Boolean).join("\n");
  const kb = new InlineKeyboard();
  if (!p.refundedAt) kb.text("↩ Вернуть звёзды", `pur.ref:${p.id}`).row();
  kb.text("👤 Игрок", `pl.show:${p.userId}`).text("◀ К покупкам", "pur");
  await show(ctx, text, kb);
}

/** Пометить покупку возвращённой и забрать неоткрытое яйцо. Используется и админкой, и обработчиком refunded_payment. */
export async function markRefunded(chargeId: string, adminId?: number) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.purchase.findUnique({ where: { telegramChargeId: chargeId } });
    if (!p) return null;
    await tx.purchase.updateMany({ where: { id: p.id, refundedAt: null }, data: { refundedAt: new Date(), refundedBy: adminId ? BigInt(adminId) : null } });
    const removed = await tx.eggGrant.deleteMany({ where: { userId: p.userId, dedupeKey: `purchase:${chargeId}`, usedAt: null } });
    if (adminId) await tx.adminLog.create({ data: { adminId: BigInt(adminId), action: "purchase.refund", payload: { purchaseId: p.id, stars: p.stars, eggRemoved: removed.count > 0 } } });
    return { purchase: p, eggRemoved: removed.count > 0 };
  });
}

export function registerPurchases(bot: Bot<AdminContext>, opts: AdminBotOptions) {
  bot.callbackQuery("pur", (ctx) => showList(ctx));
  bot.callbackQuery(/^pur\.u:(\d+)$/, (ctx) => showList(ctx, Number(ctx.match[1])));
  bot.callbackQuery(/^pur:(\d+)$/, (ctx) => showCard(ctx, Number(ctx.match[1])));

  bot.callbackQuery(/^pur\.ref:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const p = await prisma.purchase.findUnique({ where: { id }, include: { user: true } });
    if (!p || p.refundedAt) return showCard(ctx, id);
    const egg = await eggStatus(p);
    const kb = new InlineKeyboard().text(`↩ Да, вернуть ${p.stars} ⭐`, `pur.refok:${id}`).row().text("Отмена", `pur:${id}`);
    await show(ctx, [
      `Вернуть <b>${p.stars} ⭐</b> игроку ${esc(displayName(p.user))}?`,
      "",
      egg.opened ? "⚠️ Яйцо уже открыто: фигурка останется у игрока." : "Неоткрытое купленное яйцо заберём у игрока.",
      "Звёзды вернутся игроку сразу, отменить возврат нельзя.",
    ].join("\n"), kb);
  });

  bot.callbackQuery(/^pur\.refok:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const p = await prisma.purchase.findUnique({ where: { id }, include: { user: true } });
    if (!p || p.refundedAt) return showCard(ctx, id);
    const api = gameApi(opts);
    if (!api) return showCard(ctx, id, "Возврат недоступен: не задан BOT_TOKEN игрового бота.\n");
    try {
      await api.refundStarPayment(Number(p.user.telegramId), p.telegramChargeId);
    } catch (e) {
      const why = e instanceof GrammyError ? e.description : String(e);
      return showCard(ctx, id, `❌ Telegram не принял возврат: ${esc(why)}\n`);
    }
    const r = await markRefunded(p.telegramChargeId, ctx.from.id);
    await ctx.answerCallbackQuery("Звёзды возвращены");
    await showCard(ctx, id, `✅ Возвращено ${p.stars} ⭐${r?.eggRemoved ? ", неоткрытое яйцо забрано" : ""}.\n`);
  });
}

