/**
 * Игровой бот: открывает Mini App, принимает оплату Stars, шлёт уведомления.
 */
import { Bot, GrammyError, InlineKeyboard, type Api } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { prisma } from "../db.js";
import { upsertTgUser } from "../game/social.js";
import { fulfillPayment, validateCheckout } from "../game/shop.js";
import { eggInterval } from "../game/core.js";
import { getActiveRules } from "../seasons/active.js";
import { markRefunded } from "../admin/purchases.js";

export type GameBotOptions = { token: string; webAppUrl: string; botInfo?: UserFromGetMe };

/** Кнопка «Открыть игру». Telegram принимает Mini App только по https — локально будет обычная ссылка. */
export function playKeyboard(webAppUrl: string, text = "🥚 Открыть игру") {
  return webAppUrl.startsWith("https://")
    ? new InlineKeyboard().webApp(text, webAppUrl)
    : new InlineKeyboard().url(text, webAppUrl);
}

export function createGameBot(opts: GameBotOptions) {
  const bot = new Bot(opts.token, { botInfo: opts.botInfo });

  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    const payload = ctx.match?.trim();
    const { user } = await upsertTgUser(ctx.from, payload?.startsWith("ref_") ? payload : undefined);
    // Пользователь сам написал боту — значит, ему можно присылать уведомления
    await prisma.user.update({ where: { id: user.id }, data: { notificationsEnabled: true, botBlocked: false } });
    await ctx.reply(
      "🥚 <b>Сюрприз дня</b>\n\nКаждый день новое яйцо с фигуркой внутри. Соберите все 16 фигурок сезона, меняйтесь с друзьями и попадите в таблицу лидеров.\n\nЯ напомню, когда будет готово новое яйцо.",
      { parse_mode: "HTML", reply_markup: playKeyboard(opts.webAppUrl) },
    );
  });

  bot.command("stop", async (ctx) => {
    if (!ctx.from) return;
    await prisma.user.updateMany({ where: { telegramId: BigInt(ctx.from.id) }, data: { notificationsEnabled: false } });
    await ctx.reply("Уведомления выключены. Включить снова: /start");
  });

  bot.on("pre_checkout_query", async (ctx) => {
    const q = ctx.preCheckoutQuery;
    const error = await validateCheckout(q.invoice_payload, q.total_amount, q.from.id).catch(() => "Не удалось проверить счёт");
    await ctx.answerPreCheckoutQuery(!error, error ? { error_message: error } : undefined);
  });

  bot.on("message:successful_payment", async (ctx) => {
    const p = ctx.message.successful_payment;
    const r = await fulfillPayment(p.invoice_payload, p.telegram_payment_charge_id, p.total_amount);
    if (!r.duplicate) await ctx.reply("✅ Оплата прошла. Бонусное яйцо уже ждёт в игре!", { reply_markup: playKeyboard(opts.webAppUrl) });
  });

  bot.on("message:refunded_payment", async (ctx) => {
    await markRefunded(ctx.message.refunded_payment.telegram_payment_charge_id);
  });

  // Пользователь заблокировал или разблокировал бота
  bot.on("my_chat_member", async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    await prisma.user.updateMany({
      where: { telegramId: BigInt(ctx.myChatMember.from.id) },
      data: { botBlocked: status === "kicked" || status === "left" },
    });
  });

  bot.catch((err) => console.error("[game-bot]", err.error));
  return bot;
}

/** Сообщение игроку от игрового бота. Ошибки не роняют запрос; заблокировавших помечаем. */
export async function notifyUser(api: Api, webAppUrl: string, userId: number, text: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.notificationsEnabled || user.botBlocked || user.isBanned) return false;
  try {
    await api.sendMessage(Number(user.telegramId), text, { reply_markup: playKeyboard(webAppUrl) });
    return true;
  } catch (e) {
    if (e instanceof GrammyError && e.error_code === 403) await prisma.user.update({ where: { id: userId }, data: { botBlocked: true } });
    else console.error("[notify]", e);
    return false;
  }
}

/** Раз в минуту: кому пора напомнить, что яйцо дня готово */
export async function notifyEggReady(api: Api, webAppUrl: string) {
  const secs = eggInterval(await getActiveRules()) / 1000;
  const due = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM users
    WHERE "notificationsEnabled" AND NOT "botBlocked" AND NOT "isBanned"
      AND "lastFreeEggAt" IS NOT NULL AND "lastFreeEggAt" <= now() - ${secs} * interval '1 second'
      AND ("eggReadyNotifiedAt" IS NULL OR "eggReadyNotifiedAt" < "lastFreeEggAt" + ${secs} * interval '1 second')
    LIMIT 200`;
  for (const { id } of due) {
    await prisma.user.update({ where: { id }, data: { eggReadyNotifiedAt: new Date() } });
    await notifyUser(api, webAppUrl, id, "🥚 Новое яйцо дня готово! Загляните, что внутри.");
    await new Promise((r) => setTimeout(r, 40));
  }
  return due.length;
}
