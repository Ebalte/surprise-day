import { Api, GrammyError, InlineKeyboard, InputFile, type Bot } from "grammy";
import { prisma, startOfUtcDay } from "../db.js";
import { backToMenu, esc, gameApi, show, type AdminBotOptions, type AdminContext, type StepHandlers } from "./bot.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let broadcastRunning = false;

async function showStats(ctx: AdminContext) {
  const today = startOfUtcDay();
  const [users, newToday, activeToday, eggsToday, purchases, adEggs, activeAds, banned, pairs, fullPairs, gamesToday] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: today } } }),
    prisma.eggLog.count({ where: { createdAt: { gte: today }, source: { not: "CRAFT" } } }),
    prisma.purchase.aggregate({ where: { createdAt: { gte: today }, refundedAt: null }, _count: true, _sum: { stars: true } }),
    prisma.eggGrant.count({ where: { source: "AD", createdAt: { gte: today } } }),
    prisma.adCampaign.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isBanned: true } }),
    prisma.pair.count(),
    prisma.pair.count({ where: { partnerId: { not: null } } }),
    prisma.gameRun.count({ where: { finishedAt: { gte: today } } }),
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
    `Мини-игр сыграно: <b>${gamesToday}</b>`,
    `Пати с общим питомцем: <b>${fullPairs}</b> (ещё ждут второго: ${pairs - fullPairs})`,
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
    .text(user.isBanned ? "✅ Разбанить" : "🚫 Забанить", `pl.ban:${userId}`).text("💳 Покупки", `pur.u:${userId}`).row()
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
  bot.callbackQuery(/^pl\.show:(\d+)$/, (ctx) => showPlayer(ctx, Number(ctx.match[1])));
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
    if (!gameApi(opts)) return show(ctx, "Рассылка недоступна: не задан BOT_TOKEN игрового бота.", backToMenu());
    if (broadcastRunning) return show(ctx, "Рассылка уже идёт. Дождитесь отчёта.", backToMenu());
    ctx.session.step = "bc.text";
    await show(ctx, `<b>Рассылка</b>\nПолучат игроки, которые разрешили уведомления: <b>${await recipients()}</b>.\n\nПришлите сообщение: текст, фото, видео или GIF с подписью. Под ним будет кнопка «Открыть игру».\n\n/cancel — отменить`);
  });

  const GAME_BUTTON = "Открыть игру";
  const preview = async (ctx: AdminContext) => {
    const d = ctx.session.broadcast!;
    await ctx.reply("Так увидят игроки:");
    await sendBroadcastMessage(ctx.api, ctx.chat!.id, { text: d.text, media: d.media && { type: d.media.type, file: d.media.fileId } }, toButton(d.button, opts, "preview"));
    const btn = d.button;
    const kb = new InlineKeyboard()
      .text(`📨 Отправить ${await recipients()} игрокам`, "bc.send").row()
      .text("✏️ Текст кнопки", "bc.btntext").text("🔗 Ссылка кнопки", "bc.btnurl").row();
    if (!btn || !btn.game) kb.text("🥚 Кнопка на игру", "bc.btngame");
    if (btn) kb.text("🚫 Без кнопки", "bc.nobtn");
    kb.row().text("✖ Отмена", "menu");
    const where = !btn ? "без кнопки" : btn.game ? `«${esc(btn.text)}» → игра в Telegram` : `«${esc(btn.text)}» → ${esc(btn.url!)}`;
    await ctx.reply(`Кнопка: ${where}\n\nОтправляем?`, { parse_mode: "HTML", reply_markup: kb });
  };

  steps["bc.text"] = async (ctx) => {
    const m = ctx.message!;
    let media: BroadcastMedia | undefined;
    let size = 0;
    if (m.photo) { const p = m.photo[m.photo.length - 1]; media = { type: "photo", fileId: p.file_id }; size = p.file_size ?? 0; }
    else if (m.video) { media = { type: "video", fileId: m.video.file_id }; size = m.video.file_size ?? 0; }
    else if (m.animation) { media = { type: "animation", fileId: m.animation.file_id }; size = m.animation.file_size ?? 0; }
    else if (m.document || m.audio || m.voice || m.video_note || m.sticker) {
      return void (await ctx.reply("Такой тип не поддерживается. Пришлите текст, фото, видео или GIF."));
    }
    const text = (m.caption ?? m.text ?? "").trim();
    if (!media && !text) return void (await ctx.reply("Пришлите текст, фото, видео или GIF."));
    if (media && text.length > 1024) return void (await ctx.reply(`Подпись к ${media.type === "photo" ? "фото" : "видео"} длинновата: ${text.length} символов. Telegram разрешает до 1024.`));
    if (!media && text.length > 3500) return void (await ctx.reply("Слишком длинно. Максимум 3500 символов."));
    // Bot API отдаёт ботам файлы только до 20 МБ — больше не получится переслать от имени игрового бота
    if (size > MAX_FILE) return void (await ctx.reply(`Файл ${(size / 1048576).toFixed(1)} МБ, а Telegram даёт боту скачать максимум 20 МБ. Сожмите видео и пришлите снова.`));
    ctx.session.step = undefined;
    ctx.session.broadcast = { text, media, button: { text: GAME_BUTTON, game: true } };
    await preview(ctx);
  };

  bot.callbackQuery("bc.btntext", async (ctx) => {
    if (!ctx.session.broadcast) return show(ctx, "Сначала пришлите сообщение для рассылки.", backToMenu());
    ctx.session.step = "bc.btntext";
    await ctx.reply("Пришлите текст кнопки (до 40 символов).\n\n/cancel — отменить");
  });
  steps["bc.btntext"] = async (ctx) => {
    const t = ctx.message?.text?.trim();
    if (!t || t.startsWith("/")) return void (await ctx.reply("Пришлите текст кнопки."));
    if (t.length > 40) return void (await ctx.reply(`Длинновато: ${t.length} символов. Максимум 40.`));
    const d = ctx.session.broadcast!;
    d.button = { ...(d.button ?? { game: true }), text: t };
    ctx.session.step = undefined;
    await preview(ctx);
  };

  bot.callbackQuery("bc.btnurl", async (ctx) => {
    if (!ctx.session.broadcast) return show(ctx, "Сначала пришлите сообщение для рассылки.", backToMenu());
    ctx.session.step = "bc.btnurl";
    await ctx.reply("Пришлите ссылку для кнопки: https://… или t.me/… Например, на канал, сайт или другого бота.\n\n/cancel — отменить");
  });
  steps["bc.btnurl"] = async (ctx) => {
    const raw = ctx.message?.text?.trim() ?? "";
    const url = normalizeUrl(raw);
    if (!url) return void (await ctx.reply("Это не похоже на ссылку. Пример: https://t.me/mychannel"));
    const d = ctx.session.broadcast!;
    const keepText = d.button && !(d.button.game && d.button.text === GAME_BUTTON);
    d.button = { text: keepText ? d.button!.text : "Подробнее", url, game: false };
    ctx.session.step = undefined;
    await preview(ctx);
  };

  bot.callbackQuery("bc.btngame", async (ctx) => {
    if (!ctx.session.broadcast) return show(ctx, "Сначала пришлите сообщение для рассылки.", backToMenu());
    ctx.session.broadcast.button = { text: GAME_BUTTON, game: true };
    await preview(ctx);
  });
  bot.callbackQuery("bc.nobtn", async (ctx) => {
    if (!ctx.session.broadcast) return show(ctx, "Сначала пришлите сообщение для рассылки.", backToMenu());
    ctx.session.broadcast.button = null;
    await preview(ctx);
  });

  bot.callbackQuery("bc.send", async (ctx) => {
    const draft = ctx.session.broadcast;
    const api = gameApi(opts);
    if (!draft || !api || broadcastRunning) return show(ctx, "Нечего отправлять.", backToMenu());
    ctx.session.broadcast = undefined;
    broadcastRunning = true;
    await show(ctx, "📨 Рассылка началась. Пришлю отчёт, когда закончу.");
    const adminChat = ctx.chat!.id, adminApi = ctx.api, adminId = ctx.from.id;
    const download = opts.downloadFile ?? ((fileId: string) => downloadFromTelegram(adminApi, opts.token, fileId));
    void (async () => {
      // Файл принадлежит админ-боту: скачиваем один раз и отдаём игровому боту как новый файл
      const media = draft.media ? { type: draft.media.type, file: new InputFile(await download(draft.media.fileId), fileName(draft.media.type)) as InputFile | string } : undefined;
      return runBroadcast(api, { text: draft.text, media }, toButton(draft.button, opts, "game-bot"));
    })()
      .then(async (r) => {
        await prisma.adminLog.create({ data: { adminId: BigInt(adminId), action: "broadcast", payload: { ...r, text: draft.text, media: draft.media?.type ?? null, button: draft.button ?? null } } });
        await adminApi.sendMessage(adminChat, `✅ Рассылка завершена.\nДоставлено: ${r.sent}\nЗаблокировали бота: ${r.blocked}\nОшибок: ${r.failed}`, { reply_markup: backToMenu() });
      })
      .catch((e) => adminApi.sendMessage(adminChat, `Рассылка прервалась: ${e instanceof GrammyError ? e.description : String(e)}`))
      .finally(() => { broadcastRunning = false; });
  });
}

const MAX_FILE = 20 * 1024 * 1024;
export type BroadcastMedia = { type: "photo" | "video" | "animation"; fileId: string };
/** game: кнопка открывает игру внутри Telegram; иначе — обычная ссылка url */
export type BroadcastButton = { text: string; game: boolean; url?: string };
export type BroadcastDraft = { text: string; media?: BroadcastMedia; button: BroadcastButton | null };
type OutMessage = { text: string; media?: { type: BroadcastMedia["type"]; file: InputFile | string } };
const fileName = (t: BroadcastMedia["type"]) => (t === "photo" ? "photo.jpg" : "video.mp4");

function normalizeUrl(raw: string): string | null {
  const s = /^t\.me\//i.test(raw) ? `https://${raw}` : raw;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Кнопка под сообщением. Кнопка «на игру»:
 * - от игрового бота — web_app: игра открывается внутри Telegram сразу, без браузера;
 * - в предпросмотре у админ-бота — t.me-ссылка на Mini App (web_app-кнопка там открыла бы игру от имени чужого бота).
 */
function toButton(b: BroadcastButton | null, opts: AdminBotOptions, sender: "game-bot" | "preview"): InlineKeyboard | undefined {
  if (!b) return undefined;
  if (!b.game) return new InlineKeyboard().url(b.text, b.url!);
  if (sender === "game-bot" && opts.webAppUrl?.startsWith("https://")) return new InlineKeyboard().webApp(b.text, opts.webAppUrl);
  const link = opts.gameLink ?? opts.webAppUrl;
  return link ? new InlineKeyboard().url(b.text, link) : undefined;
}

async function downloadFromTelegram(api: Api, token: string, fileId: string) {
  const f = await api.getFile(fileId);
  if (!f.file_path) throw new Error("Telegram не отдал файл");
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
  if (!res.ok) throw new Error(`Не удалось скачать файл: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Одно сообщение рассылки. Возвращает file_id, который Telegram присвоил загруженному файлу. */
async function sendBroadcastMessage(api: Api, chatId: number, msg: OutMessage, reply_markup?: InlineKeyboard) {
  const caption = msg.text || undefined;
  if (!msg.media) { await api.sendMessage(chatId, msg.text, { reply_markup }); return undefined; }
  const { type, file } = msg.media;
  if (type === "photo") { const r = await api.sendPhoto(chatId, file, { caption, reply_markup }); return r.photo?.at(-1)?.file_id; }
  if (type === "video") { const r = await api.sendVideo(chatId, file, { caption, reply_markup, supports_streaming: true }); return r.video?.file_id; }
  const r = await api.sendAnimation(chatId, file, { caption, reply_markup });
  return r.animation?.file_id;
}

/** Шлёт сообщение всем, кто разрешил уведомления. ~25 сообщений в секунду — в пределах лимита Telegram. */
export async function runBroadcast(api: Api, msg: OutMessage | string, keyboard?: InlineKeyboard) {
  const out: OutMessage = typeof msg === "string" ? { text: msg } : { ...msg, media: msg.media && { ...msg.media } };
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
          const fileId = await sendBroadcastMessage(api, Number(u.telegramId), out, keyboard);
          // После первой успешной загрузки остальным шлём уже готовый файл по file_id — без повторной загрузки
          if (out.media && fileId && typeof out.media.file !== "string") out.media.file = fileId;
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
