/**
 * Запуск админ-бота: npm run admin:dev (локально) или npm run admin:start (прод).
 * Работает через long polling, поэтому ему не нужен публичный URL.
 */
import { createAdminBot } from "./bot.js";
import { prisma } from "../db.js";

const token = process.env.ADMIN_BOT_TOKEN;
const adminIds = (process.env.ADMIN_IDS ?? "").split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isInteger);

if (!token) throw new Error("Не задан ADMIN_BOT_TOKEN — токен отдельного админ-бота от @BotFather");
if (!adminIds.length) throw new Error("Не задан ADMIN_IDS — Telegram ID администраторов через запятую");

const bot = createAdminBot({
  token,
  adminIds,
  gameBotToken: process.env.BOT_TOKEN,
  webAppUrl: process.env.WEB_APP_URL,
});

await bot.api.setMyCommands([
  { command: "menu", description: "Главное меню" },
  { command: "cancel", description: "Отменить текущее действие" },
]);

const stop = async () => {
  await bot.stop();
  await prisma.$disconnect();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

await bot.start({
  onStart: (me) => console.log(`Админ-бот @${me.username} запущен. Администраторы: ${adminIds.join(", ")}`),
});
