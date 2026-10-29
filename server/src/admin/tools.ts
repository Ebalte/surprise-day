import { Api, GrammyError, InlineKeyboard, type Bot } from "grammy";
import { prisma, startOfUtcDay } from "../db.js";
import { backToMenu, esc, show, type AdminBotOptions, type AdminContext, type StepHandlers } from "./bot.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let broadcastRunning = false;

async function showStats(ctx: AdminContext) {
  const today = startOfUtcDay();
  const [users, newToday, activeToday, eggsToday, purchases, adEggs, activeAds, banned] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: today } } }),
    prisma.eggLog.count({ where: { createdAt: { gte: today }, source: { not: "CRAFT" } } }),
    prisma.purchase.aggregate({ where: { createdAt: { gte: today } }, _count: true, _sum: { stars: true } }),
    prisma.eggGrant.count({ where: { source: "AD", createdAt: { gte: today } } }),
    prisma.adCampaign.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isBanned: true } }),
  ]);
  const text = [
    "<b>Статистика</b> · сегодня с 00:00 UTC",
    "",
    `Игроков всего: <b>${users}</b> (забанено: ${banned})`,
    `Новых сегодня: <b>${newToday}</b>`,
    `Заходили сегодня: <b>${activeToday}</b>`,
    `Открыто яиц: <b>${eggsToday}</b>`,
    `Покупок за Stars: <b>${purchases._count}</b> на <b>${purchases._sum.stars ?? 0}</b> ⭐`,
    `Яиц за рекламу: <b>${adEggs}</b> · активных кампаний: ${activeAds}`,
  ].join("\n");
  await show(ctx, text, new InlineKeyboard().text("🔄 Обновить", "stats").text("◀ Меню", "menu"));
}

async function showPlayer(ctx: AdminContext, userId: number, note = "") {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return show(ctx, "Игрок не найден.", backToMenu());
  const [unique, pending] = await Promise.all([
    prisma.userFigure.count({ where: { userId, figure: { season: { isActive: true }, eventSlug: null } } }),
    prisma.eggGrant.count({ where: { userId, usedAt: null } }),
  ]);
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "без имени";
  const text = [
    note,
    `<b>${esc(name)}</b>${user.username ? ` @${esc(user.username)}` : ""}${user.isBanned ? " · 🚫 забанен" : ""}`,
    `Telegram ID: <code>${user.telegramId}</code> · в игре с ${user.createdAt.toLocaleDateString("ru-RU")}`,
    `Был в игре: ${user.lastSeenAt.toLocaleString("ru-RU", { timeZone: "UTC" })} UTC`,
    "",
    `Коллекция сезона: <b>${unique}</b> фигурок`,
    `Осколки: <b>${user.shards}</b> · яиц открыто: ${user.totalEggs} · в запасе: ${pending}`,
    `Серия: ${user.streak} (лучшая ${user.bestStreak})`,
  ].filter((l, i) => i > 0 || l).join("\n");
  const kb = new InlineKeyboard()
    .text("🥚 +1 яйцо", `pl.egg:${userId}`).text("💎 +50 осколков", `pl.shards:${userId}`).row()
    .text(user.isBanned ? "✅ Разбанить" : "🚫 Забанить", `pl.ban:${userId}`).row()
    .text("🔎 Другой игрок", "player").text("◀ Меню", "menu");
  await show(ctx, text, kb);
}

export function registerTools(bot: Bot<AdminContext>, steps: StepHandlers, opts: AdminBotOptions) {
  bot.callbackQuery("stats", showStats);

  // ---------- игрок ----------
  bot.callbackQuery("player", async (ctx) => {
    ctx.session.step = "player.find";
    await show(ctx, "Пришлите Telegram ID или @username игрока.\n\n/cancel — отменить");
  });
  steps["player.find"] = async (ctx) => {
    const q = ctx.message?.text?.trim() ?? "";
    const user = /^\d+$/.test(q)
      ? await prisma.user.findUnique({ where: { telegramId: BigInt(q) } })
      : await prisma.user.findFirst({ where: { username: { equals: q.replace(/^@/, ""), mode: "insensitive" } } });
    if (!user) return void (await ctx.reply("Такого игрока нет. Проверьте ID или username и пришлите ещё раз."));
    ctx.session.step = undefined;
    await showPlayer(ctx, user.id);
  };
  bot.callbackQuery(/^pl\.egg:(\d+)$/, async (ctx) => {
    const userId = Number(ctx.match[1]);
    await prisma.$transaction([
      prisma.eggGrant.create({ data: { userId, source: "ADMIN", dedupeKey: `admin:${ctx.from.id}:${Date.now()}` } }),
      prisma.adminLog.create({ data: { adminId: BigInt(ctx.from.id), action: "player.egg", payload: { userId } } }),
    ]);
    await showPlayer(ctx, userId, "✅ Выдано бонусное яйцо\n");
  });
  bot.callbackQuery(/^pl\.shards:(\d+)$/, async (ctx) => {
    const userId = Number(ctx.match[1]);
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { shards: { increment: 50 } } }),
      prisma.adminLog.create({ data: { adminId: BigInt(ctx.from.id), action: "player.shards", payload: { userId, amount: 50 } } }),
    ]);
    await showPlayer(ctx, userId, "✅ Начислено 50 осколков\n");
  });
  bot.callbackQuery(/^pl\.ban:(\d+)$/, async (ctx) => {
    const userId = Number(ctx.match[1]);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { isBanned: !user.isBanned } }),
      prisma.adminLog.create({ data: { adminId: BigInt(ctx.from.id), action: user.isBanned ? "player.unban" : "player.ban", payload: { userId } } }),
    ]);
    await showPlayer(ctx, userId, user.isBanned ? "✅ Разбанен\n" : "🚫 Забанен\n");
  });

  // ---------- рассылка ----------
  const recipients = () => prisma.user.count({ where: { notificationsEnabled: true, botBlocked: false, isBanned: false } });

  bot.callbackQuery("bc", async (ctx) => {
    if (!opts.gameBotToken) return show(ctx, "Рассылка недоступна: не задан BOT_TOKEN игрового бота.", backToMenu());
    if (broadcastRunning) return show(ctx, "Рассылка уже идёт. Дождитесь отчёта.", backToMenu());
    ctx.session.step = "bc.text";
    await show(ctx, `<b>Рассылка</b>\nПолучат игроки, которые разрешили уведомления: <b>${await recipients()}</b>.\n\nПришлите текст сообщения. Под ним будет кнопка «Открыть игру».\n\n/cancel — отменить`);
  });
  steps["bc.text"] = async (ctx) => {
    const text = ctx.message?.text?.trim();
    if (!text) return void (await ctx.reply("Пришлите текст. Картинки в рассылке пока не поддерживаются."));
    if (text.length > 3500) return void (await ctx.reply("Слишком длинно. Максимум 3500 символов."));
    ctx.session.step = undefined;
    ctx.session.broadcast = text;
    await ctx.reply("Так увидят игроки:");
    await ctx.reply(text, { reply_markup: opts.webAppUrl ? new InlineKeyboard().url("Открыть игру", opts.webAppUrl) : undefined });
    const kb = new InlineKeyboard().text(`📨 Отправить ${await recipients()} игрокам`, "bc.send").row().text("✖ Отмена", "menu");
    await ctx.reply("Отправляем?", { reply_markup: kb });
  };
  bot.callbackQuery("bc.send", async (ctx) => {
    const text = ctx.session.broadcast;
    if (!text || !opts.gameBotToken || broadcastRunning) return show(ctx, "Нечего отправлять.", backToMenu());
    ctx.session.broadcast = undefined;
    broadcastRunning = true;
    await show(ctx, "📨 Рассылка началась. Пришлю отчёт, когда закончу.");
    const adminChat = ctx.chat!.id, adminApi = ctx.api, adminId = ctx.from.id;
    void runBroadcast(new Api(opts.gameBotToken), text, opts.webAppUrl)
      .then(async (r) => {
        await prisma.adminLog.create({ data: { adminId: BigInt(adminId), action: "broadcast", payload: { ...r, text } } });
        await adminApi.sendMessage(adminChat, `✅ Рассылка завершена.\nДоставлено: ${r.sent}\nЗаблокировали бота: ${r.blocked}\nОшибок: ${r.failed}`, { reply_markup: backToMenu() });
      })
      .catch((e) => adminApi.sendMessage(adminChat, `Рассылка прервалась: ${String(e)}`))
      .finally(() => { broadcastRunning = false; });
  });
}

/** Шлёт сообщение всем, кто разрешил уведомления. ~25 сообщений в секунду — в пределах лимита Telegram. */
export async function runBroadcast(api: Api, text: string, webAppUrl?: string) {
  const kb = webAppUrl ? new InlineKeyboard().url("Открыть игру", webAppUrl) : undefined;
  const r = { sent: 0, blocked: 0, failed: 0 };
  let cursor = 0;
  for (;;) {
    const batch = await prisma.user.findMany({
      where: { notificationsEnabled: true, botBlocked: false, isBanned: false, id: { gt: cursor } },
      orderBy: { id: "asc" }, take: 500, select: { id: true, telegramId: true },
    });
    if (!batch.length) break;
    for (const u of batch) {
      cursor = u.id;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await api.sendMessage(Number(u.telegramId), text, { reply_markup: kb });
          r.sent++;
          break;
        } catch (e) {
          if (e instanceof GrammyError && e.error_code === 429) { await sleep(((e.parameters.retry_after ?? 1) + 1) * 1000); continue; }
          if (e instanceof GrammyError && e.error_code === 403) {
            await prisma.user.update({ where: { id: u.id }, data: { botBlocked: true } });
            r.blocked++;
          } else r.failed++;
          break;
        }
      }
      await sleep(40);
    }
  }
  return r;
}
