/**
 * Админ-бот: отдельный Telegram-бот только для администраторов.
 * Доступ — по Telegram ID из ADMIN_IDS. Всё остальное игнорируется.
 */
import { Api, Bot, Context, GrammyError, InlineKeyboard, session, type SessionFlavor } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { registerAds } from "./ads.js";
import { registerSettings } from "./settings.js";
import { registerTools } from "./tools.js";
import { registerPurchases } from "./purchases.js";

export type AdDraft = {
  placement?: "REWARDED" | "BANNER";
  title?: string;
  text?: string;
  mediaFileId?: string;
  mediaType?: "photo" | "video";
  url?: string;
  buttonText?: string;
  durationSec?: number;
  endsAt?: string;
};

export type AdminSession = {
  /** Текущий шаг диалога: какое сообщение бот ждёт от администратора */
  step?: string;
  ad?: AdDraft;
  settingKey?: string;
  broadcast?: string;
};

export type AdminContext = Context & SessionFlavor<AdminSession>;

export type AdminBotOptions = {
  token: string;
  adminIds: number[];
  /** Токен игрового бота — для рассылки игрокам и возврата звёзд */
  gameBotToken?: string;
  /** Для тестов: готовый клиент игрового бота вместо токена */
  gameApi?: Api;
  webAppUrl?: string;
  /** Для тестов: чтобы бот не ходил в getMe */
  botInfo?: UserFromGetMe;
};

/** Обработчики шагов диалога: модули регистрируют их по имени шага */
export type StepHandlers = Record<string, (ctx: AdminContext) => Promise<void>>;

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export const menuKeyboard = () =>
  new InlineKeyboard()
    .text("📢 Реклама", "ads").text("⚙️ Настройки", "settings").row()
    .text("📊 Статистика", "stats").text("👤 Игрок", "player").row()
    .text("💳 Покупки", "pur").text("📨 Рассылка", "bc");

export const backToMenu = () => new InlineKeyboard().text("◀ Меню", "menu");

/** Показать экран: на нажатие кнопки — отредактировать сообщение, иначе — новое */
export async function show(ctx: AdminContext, text: string, keyboard?: InlineKeyboard) {
  const opts = { parse_mode: "HTML" as const, reply_markup: keyboard, link_preview_options: { is_disabled: true } };
  if (ctx.callbackQuery?.message && "text" in ctx.callbackQuery.message) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch (e) {
      if (e instanceof GrammyError && e.description.includes("message is not modified")) return;
    }
  }
  await ctx.reply(text, opts);
}

/** Клиент игрового бота: от его имени идут рассылки и возвраты звёзд */
export const gameApi = (opts: AdminBotOptions) => opts.gameApi ?? (opts.gameBotToken ? new Api(opts.gameBotToken) : null);

export async function showMenu(ctx: AdminContext) {
  ctx.session.step = undefined;
  await show(ctx, "<b>Сюрприз дня · админка</b>\nЧто настроим?", menuKeyboard());
}

export function createAdminBot(opts: AdminBotOptions) {
  const bot = new Bot<AdminContext>(opts.token, { botInfo: opts.botInfo });

  bot.use(async (ctx, next) => {
    if (!ctx.from || !opts.adminIds.includes(ctx.from.id)) {
      if (ctx.chat?.type === "private") {
        await ctx.reply(`Нет доступа. Ваш Telegram ID: ${ctx.from?.id ?? "?"}. Чтобы стать администратором, его нужно добавить в ADMIN_IDS.`);
      }
      return;
    }
    await next();
  });
  bot.use(session({ initial: (): AdminSession => ({}) }));
  bot.use(async (ctx, next) => {
    await next();
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
  });

  bot.command(["start", "menu"], showMenu);
  bot.command("cancel", async (ctx) => {
    ctx.session = {};
    await ctx.reply("Отменено.", { reply_markup: menuKeyboard() });
  });
  bot.callbackQuery("menu", showMenu);

  const steps: StepHandlers = {};
  registerAds(bot, steps);
  registerSettings(bot, steps);
  registerTools(bot, steps, opts);
  registerPurchases(bot, opts);

  bot.on("message", async (ctx) => {
    const handler = ctx.session.step ? steps[ctx.session.step] : undefined;
    if (handler) return handler(ctx);
    await showMenu(ctx);
  });

  bot.catch((err) => console.error("[admin-bot]", err.error));
  return bot;
}
