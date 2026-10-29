/**
 * Прогон админ-бота на поддельных апдейтах Telegram: без сети и без настоящего токена.
 * Все вызовы Bot API перехватываются и записываются. Нужна локальная БД (DATABASE_URL).
 * Внимание: тест очищает таблицу settings — запускайте на локальной базе, не на проде.
 * Запуск: npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createAdminBot } from "../src/admin/bot.js";
import { prisma } from "../src/db.js";
import { getActiveRules } from "../src/seasons/active.js";
import { completeAdView, startAdView, AdError } from "../src/ads/service.js";
import { invalidateSettings } from "../src/settings/service.js";
import { Api } from "grammy";
import { createEggInvoice, fulfillPayment, validateCheckout } from "../src/game/shop.js";

const ADMIN = 7001, STRANGER = 7002, TEST_TG = 990001n;
const TAG = "test-admin-";
type Call = { method: string; payload: Record<string, unknown> };
const calls: Call[] = [];
const gameCalls: Call[] = [];

// Игровой бот: от его имени идут возвраты. Платёж "chg-fail" Telegram отклоняет.
const gameApi = new Api("456:TEST_GAME");
gameApi.config.use(async (_prev, method, payload) => {
  gameCalls.push({ method, payload: payload as Record<string, unknown> });
  if ((payload as { telegram_payment_charge_id?: string }).telegram_payment_charge_id === "chg-fail") {
    return { ok: false, error_code: 400, description: "Bad Request: CHARGE_ALREADY_REFUNDED" } as never;
  }
  const msg = { message_id: 1, date: 0, chat: { id: 1, type: "private" } };
  const result = method === "createInvoiceLink" ? "https://t.me/$inv"
    : method === "sendPhoto" ? { ...msg, photo: [{ file_id: "GAME_PHOTO", file_unique_id: "g", width: 1, height: 1 }] }
    : method.startsWith("send") ? msg : true;
  return { ok: true, result } as never;
});

const bot = createAdminBot({
  token: "123:TEST",
  adminIds: [ADMIN],
  gameApi,
  webAppUrl: "https://game.example",
  downloadFile: async () => Buffer.from("fake-image"),
  botInfo: {
    id: 1, is_bot: true, first_name: "Admin", username: "surprise_admin_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
    can_connect_to_business: false, has_main_web_app: false,
  } as never,
});
let msgId = 100;
bot.api.config.use(async (_prev, method, payload) => {
  calls.push({ method, payload: payload as Record<string, unknown> });
  const result = method.startsWith("send") || method === "editMessageText"
    ? { message_id: ++msgId, date: 0, chat: { id: ADMIN, type: "private" }, text: (payload as { text?: string }).text }
    : true;
  return { ok: true, result } as never;
});

let updateId = 1;
const from = (id: number) => ({ id, is_bot: false, first_name: "Тест" });
const chat = (id: number) => ({ id, type: "private" as const, first_name: "Тест" });
async function send(text: string, id = ADMIN, extra: Record<string, unknown> = {}) {
  const entities = text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] : undefined;
  await bot.handleUpdate({ update_id: updateId++, message: { message_id: ++msgId, date: 0, chat: chat(id), from: from(id), text, entities, ...extra } } as never);
}
async function photo(caption: string) {
  await bot.handleUpdate({ update_id: updateId++, message: {
    message_id: ++msgId, date: 0, chat: chat(ADMIN), from: from(ADMIN), caption,
    photo: [{ file_id: "small", file_unique_id: "s", width: 90, height: 90 }, { file_id: "BIG_PHOTO", file_unique_id: "b", width: 800, height: 800 }],
  } } as never);
}
async function tap(data: string) {
  await bot.handleUpdate({ update_id: updateId++, callback_query: {
    id: String(updateId), from: from(ADMIN), chat_instance: "x", data,
    message: { message_id: 1, date: 0, chat: chat(ADMIN), text: "экран", from: { id: 1, is_bot: true, first_name: "Admin" } },
  } } as never);
}
const lastText = () => {
  const c = [...calls].reverse().find((x) => typeof x.payload.text === "string" || typeof x.payload.caption === "string");
  return String(c?.payload.text ?? c?.payload.caption ?? "");
};

async function cleanup() {
  await prisma.adCampaign.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.setting.deleteMany({});
  await prisma.user.deleteMany({ where: { telegramId: { in: [TEST_TG, TEST_TG + 1n] } } });
  invalidateSettings();
}
before(cleanup);
after(async () => { await cleanup(); await prisma.$disconnect(); });

test("чужой не получает доступ", async () => {
  calls.length = 0;
  await send("/start", STRANGER);
  assert.match(lastText(), /Нет доступа.*7002/);
});

test("меню открывается администратору", async () => {
  await send("/start");
  assert.match(lastText(), /админка/);
});

test("создание рекламы за яйцо от начала до запуска", async () => {
  await tap("ad.new");
  assert.match(lastText(), /Где показывать/);
  await tap("adp:REWARDED");
  await send(`${TAG}пицца`);
  assert.match(lastText(), /картинку или видео/);
  await photo("");
  assert.match(lastText(), /Добавьте подпись/);
  await photo("Пицца со скидкой 20%");
  await send("не ссылка");
  assert.match(lastText(), /не похоже на ссылку/);
  await send("https://pizza.example/promo");
  await send("Заказать");
  await send("99");
  assert.match(lastText(), /от 3 до 30/);
  await send("4");
  await send("01.01.2020");
  assert.match(lastText(), /уже прошла/);
  await send("31.12.2030");
  assert.ok(calls.some((c) => c.method === "sendPhoto" && c.payload.photo === "BIG_PHOTO"), "предпросмотр с картинкой");
  await tap("ad.save:1");
  const ad = await prisma.adCampaign.findFirstOrThrow({ where: { title: `${TAG}пицца` } });
  assert.equal(ad.placement, "REWARDED");
  assert.equal(ad.isActive, true);
  assert.equal(ad.mediaFileId, "BIG_PHOTO");
  assert.equal(ad.url, "https://pizza.example/promo");
  assert.equal(ad.buttonText, "Заказать");
  assert.equal(ad.durationSec, 4);
  assert.equal(ad.endsAt?.toISOString(), "2030-12-31T23:59:59.000Z");
  assert.match(lastText(), /Показы: <b>0<\/b>/);

  await tap(`ad.toggle:${ad.id}`);
  assert.equal((await prisma.adCampaign.findUniqueOrThrow({ where: { id: ad.id } })).isActive, false);
  await tap(`ad.toggle:${ad.id}`);
});

test("настройка цен в осколках: ошибка, потом сохранение и применение к правилам", async () => {
  await tap("settings");
  assert.match(lastText(), /Цены фигурок в осколках: <b>обычная 30 · редкая 60 · эпическая 120<\/b>/);
  await tap("set:craftCosts");
  await send("30 60");
  assert.match(lastText(), /Нужно чисел: 3/);
  await send("20 50 100");
  assert.match(lastText(), /✅ Цены фигурок в осколках/);
  const rules = await getActiveRules();
  assert.deepEqual(rules.craftCosts, { common: 20, rare: 50, epic: 100 });

  await tap("set:shop.eggPricesStars");
  await send("10 20 40 80");
  assert.deepEqual((await getActiveRules()).shop.eggPricesStars, [10, 20, 40, 80]);

  await tap("setreset:craftCosts");
  assert.deepEqual((await getActiveRules()).craftCosts, { common: 30, rare: 60, epic: 120 });
});

test("техработы включаются только после подтверждения", async () => {
  await tap("set:maintenance");
  assert.match(lastText(), /Включить техработы\?/);
  assert.equal(await prisma.setting.count({ where: { key: "maintenance" } }), 0);
  await tap("setbool:maintenance:1");
  assert.equal((await prisma.setting.findUniqueOrThrow({ where: { key: "maintenance" } })).value, true);
  await tap("set:maintenance");
  assert.equal((await prisma.setting.findUniqueOrThrow({ where: { key: "maintenance" } })).value, false);
});

test("игрок: поиск, яйцо, осколки, бан", async () => {
  const u = await prisma.user.create({ data: { telegramId: TEST_TG, username: "Tester", firstName: "Тест" } });
  await tap("player");
  await send("@tester");
  assert.match(lastText(), /Тест.*@Tester/s);
  await tap(`pl.egg:${u.id}`);
  await tap(`pl.shards:${u.id}`);
  await tap(`pl.ban:${u.id}`);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
  assert.equal(after.shards, 50);
  assert.equal(after.isBanned, true);
  assert.equal(await prisma.eggGrant.count({ where: { userId: u.id, source: "ADMIN" } }), 1);
  await tap("stats");
  assert.match(lastText(), /Игроков всего: <b>\d+<\/b>/);
});

test("показ рекламы за яйцо: рано — отказ, вовремя — яйцо, дважды — отказ", async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { telegramId: TEST_TG } });
  const t0 = new Date();
  const { viewId, ad } = await startAdView(u.id, t0);
  assert.equal(ad.mediaUrl, `/api/ads/${ad.id}/media`);
  await assert.rejects(completeAdView(u.id, viewId, new Date(t0.getTime() + 1000)), (e: AdError) => e.code === "too_early");
  const grant = await completeAdView(u.id, viewId, new Date(t0.getTime() + 4000));
  assert.equal(grant.source, "AD");
  await assert.rejects(completeAdView(u.id, viewId, new Date(t0.getTime() + 5000)), (e: AdError) => e.code === "done");
  // лимит 1 яйцо за рекламу в день
  await assert.rejects(startAdView(u.id, new Date(t0.getTime() + 6000)), (e: AdError) => e.code === "limit");
  const camp = await prisma.adCampaign.findUniqueOrThrow({ where: { id: ad.id } });
  assert.equal(camp.impressions, 1);
  assert.equal(camp.completions, 1);
});

test("выключенная реклама не показывается", async () => {
  await tap("set:ads.enabled");
  const u = await prisma.user.findUniqueOrThrow({ where: { telegramId: TEST_TG } });
  await prisma.eggGrant.deleteMany({ where: { userId: u.id, source: "AD" } });
  await assert.rejects(startAdView(u.id), (e: AdError) => e.code === "disabled");
});

test("выключатель покупок: кнопка в настройках, сервер не выдаёт и не принимает счета", async () => {
  const u = await prisma.user.update({ where: { telegramId: TEST_TG }, data: { isBanned: false } }); // забанен тестом выше
  await tap("settings");
  assert.match(lastText(), /Покупки за Stars: <b>включены<\/b>/);
  const inv = await createEggInvoice(gameApi, u);
  await tap("set:shop.enabled");
  assert.match(lastText(), /Покупки за Stars: выключены/);
  await assert.rejects(createEggInvoice(gameApi, u), /сейчас недоступна/);
  const payload = String(gameCalls.filter((c) => c.method === "createInvoiceLink").at(-1)!.payload.payload);
  assert.match(String(await validateCheckout(payload, inv.price, Number(TEST_TG))), /сейчас недоступна/, "старый счёт тоже не оплатить");
  await tap("set:shop.enabled");
  assert.equal(await validateCheckout(payload, inv.price, Number(TEST_TG)), null);
});

test("покупки: список, карточка, возврат звёзд забирает неоткрытое яйцо", async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { telegramId: TEST_TG } });
  const payload = JSON.stringify({ u: u.id, c: 0, n: 0, p: 25 });
  await fulfillPayment(payload, "chg-ok", 25);
  await fulfillPayment(payload, "chg-fail", 50);
  const ok = await prisma.purchase.findUniqueOrThrow({ where: { telegramChargeId: "chg-ok" } });

  await tap("pur");
  assert.match(lastText(), /Всего: <b>2 шт · 75 ⭐<\/b>/);
  await tap(`pur:${ok.id}`);
  assert.match(lastText(), /яйцо ещё не открыто/);
  await tap(`pur.ref:${ok.id}`);
  assert.match(lastText(), /Вернуть <b>25 ⭐<\/b>.*Неоткрытое купленное яйцо заберём/s);
  await tap(`pur.refok:${ok.id}`);
  const call = gameCalls.find((c) => c.method === "refundStarPayment" && c.payload.telegram_payment_charge_id === "chg-ok");
  assert.equal(call?.payload.user_id, Number(TEST_TG));
  assert.match(lastText(), /✅ Возвращено 25 ⭐, неоткрытое яйцо забрано/);
  assert.ok((await prisma.purchase.findUniqueOrThrow({ where: { id: ok.id } })).refundedAt);
  assert.equal(await prisma.eggGrant.count({ where: { userId: u.id, dedupeKey: "purchase:chg-ok" } }), 0);

  // повторный возврат той же покупки невозможен
  const before = gameCalls.length;
  await tap(`pur.refok:${ok.id}`);
  assert.equal(gameCalls.length, before);
  await tap("pur");
  assert.match(lastText(), /Всего: <b>1 шт · 50 ⭐<\/b>/);
  assert.match(lastText(), /Возвращено: 1 шт · 25 ⭐/);
});

test("возврат: если Telegram отказал, покупка остаётся оплаченной", async () => {
  const fail = await prisma.purchase.findUniqueOrThrow({ where: { telegramChargeId: "chg-fail" } });
  await tap(`pur.refok:${fail.id}`);
  assert.match(lastText(), /Telegram не принял возврат: Bad Request: CHARGE_ALREADY_REFUNDED/);
  assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { id: fail.id } })).refundedAt, null);
  assert.equal(await prisma.eggGrant.count({ where: { dedupeKey: "purchase:chg-fail", usedAt: null } }), 1);
});

test("рассылка с фото: первому — загрузка файла, остальным — готовый file_id", async () => {
  await prisma.user.updateMany({ data: { notificationsEnabled: false } });
  await prisma.user.update({ where: { telegramId: TEST_TG }, data: { notificationsEnabled: true, botBlocked: false } });
  await prisma.user.create({ data: { telegramId: TEST_TG + 1n, firstName: "Второй", notificationsEnabled: true } });

  await tap("bc");
  assert.match(lastText(), /текст, фото, видео или GIF/);
  await send("", ADMIN, { text: undefined, document: { file_id: "doc", file_unique_id: "d" } });
  assert.match(lastText(), /не поддерживается/);
  await send("", ADMIN, { text: undefined, caption: "Ролик", video: { file_id: "BIG", file_unique_id: "v", width: 1, height: 1, duration: 1, file_size: 30 * 1024 * 1024 } });
  assert.match(lastText(), /максимум 20 МБ/);
  await photo("Новый сезон уже в игре!");
  assert.ok(calls.some((c) => c.method === "sendPhoto" && c.payload.photo === "BIG_PHOTO" && c.payload.caption === "Новый сезон уже в игре!"), "предпросмотр админу");
  assert.match(lastText(), /Отправляем\?/);

  const before = gameCalls.length;
  await tap("bc.send");
  for (let i = 0; i < 50 && !calls.some((c) => String(c.payload.text ?? "").includes("Рассылка завершена")); i++) await new Promise((r) => setTimeout(r, 50));
  const photos = gameCalls.slice(before).filter((c) => c.method === "sendPhoto");
  assert.equal(photos.length, 2);
  assert.equal(typeof photos[0].payload.photo, "object", "первому — загрузка файла");
  assert.equal(photos[1].payload.photo, "GAME_PHOTO", "второму — уже загруженный файл");
  assert.ok(photos.every((c) => c.payload.caption === "Новый сезон уже в игре!"));
  assert.match(String(calls.findLast((c) => String(c.payload.text ?? "").includes("Рассылка завершена"))?.payload.text), /Доставлено: 2/);
});
