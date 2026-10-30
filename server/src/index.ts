/**
 * Точка входа: HTTP API + игровой бот + напоминания + (по желанию) админ-бот в одном процессе.
 */
import { env, adminIds, gameLink } from "./env.js";
import { prisma } from "./db.js";
import { buildApp } from "./http/app.js";
import { createGameBot, notifyEggReady } from "./bot/game-bot.js";
import { notifyPets } from "./bot/pet-reminders.js";
import { loadSeason } from "./game/core.js";
import { createAdminBot } from "./admin/bot.js";

const e = env();
const bot = createGameBot({ token: e.BOT_TOKEN, webAppUrl: e.WEB_APP_URL });
const app = buildApp({ env: e, botApi: bot.api, bot });

await app.listen({ port: e.PORT, host: "0.0.0.0" });

if (e.BOT_MODE !== "off") {
  await bot.init();
  await bot.api.setMyCommands([
    { command: "start", description: "Открыть игру и включить напоминания" },
    { command: "stop", description: "Выключить напоминания" },
  ]);
  if (e.WEB_APP_URL.startsWith("https://")) {
    await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "Играть", web_app: { url: e.WEB_APP_URL } } });
  }
  if (e.BOT_MODE === "webhook") {
    // Render сам сообщает публичный адрес сервиса в RENDER_EXTERNAL_URL
    const publicUrl = e.PUBLIC_API_URL ?? process.env.RENDER_EXTERNAL_URL;
    if (!publicUrl) throw new Error("Для BOT_MODE=webhook нужен PUBLIC_API_URL");
    await bot.api.setWebhook(`${publicUrl.replace(/\/$/, "")}/telegram/webhook`, {
      secret_token: e.WEBHOOK_SECRET,
      allowed_updates: ["message", "pre_checkout_query", "my_chat_member"],
    });
  } else {
    await bot.api.deleteWebhook();
    void bot.start({ allowed_updates: ["message", "pre_checkout_query", "my_chat_member"] });
  }
  app.log.info(`Игровой бот @${bot.botInfo.username} запущен (${e.BOT_MODE})`);

  let minute = 0;
  const figureName = async (code: string) => (await loadSeason()).byCode.get(code)?.name ?? "Питомец";
  setInterval(() => {
    notifyEggReady(bot.api, e.WEB_APP_URL).catch((err) => app.log.error(err, "notifier"));
    // Напоминания о питомцах — раз в 10 минут
    if (minute++ % 10 === 0) notifyPets(bot.api, e.WEB_APP_URL, new Date(), figureName).catch((err) => app.log.error(err, "pet-notifier"));
  }, 60_000);
}

const runAdmin = e.ADMIN_BOT_TOKEN && adminIds(e).length && e.RUN_ADMIN_BOT !== "false";
const admin = runAdmin
  ? createAdminBot({ token: e.ADMIN_BOT_TOKEN!, adminIds: adminIds(e), gameBotToken: e.BOT_TOKEN, webAppUrl: e.WEB_APP_URL, gameLink: gameLink(e) })
  : null;
if (admin) {
  await admin.api.deleteWebhook();
  void admin.start({ onStart: (me) => app.log.info(`Админ-бот @${me.username} запущен`) });
}

const shutdown = async () => {
  await Promise.allSettled([bot.isRunning() ? bot.stop() : null, admin?.stop(), app.close()]);
  await prisma.$disconnect();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
