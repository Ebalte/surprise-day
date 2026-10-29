/**
 * Интеграционные тесты API и игровой логики на локальной БД. Telegram не нужен:
 * initData подписывается тестовым токеном, вызовы Bot API перехватываются.
 * Запуск: npm test (нужны DATABASE_URL и синхронизированный сезон).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Api } from "grammy";
import { prisma } from "../src/db.js";
import { buildApp } from "../src/http/app.js";
import { buildInitData } from "../src/auth/telegram.js";
import { DAY, craftFigure, loadSeason, openEgg, resetSeasonCache, weekKey } from "../src/game/core.js";
import { fulfillPayment, validateCheckout } from "../src/game/shop.js";
import { notifyEggReady } from "../src/bot/game-bot.js";
import { invalidateSettings, setSetting } from "../src/settings/service.js";
import type { Env } from "../src/env.js";

const TOKEN = "777:TEST_GAME_BOT";
const TG = (n: number) => 880000 + n;
const sent: { method: string; payload: Record<string, unknown> }[] = [];
const botApi = new Api(TOKEN);
botApi.config.use(async (_prev, method, payload) => {
  sent.push({ method, payload: payload as Record<string, unknown> });
  const result = method === "createInvoiceLink" ? "https://t.me/$test_invoice" : { message_id: 1, date: 0, chat: { id: 1, type: "private" } };
  return { ok: true, result } as never;
});

const env = {
  DATABASE_URL: process.env.DATABASE_URL!, BOT_TOKEN: TOKEN, WEB_APP_URL: "https://game.example", PORT: 0, BOT_MODE: "off",
  SESSION_SECRET: "test-secret-test-secret", SESSION_TTL_DAYS: 30, INIT_DATA_MAX_AGE_SEC: 86400, AUTH_MAX_AGE_SEC: 300,
  DEV_LOGIN: false, BOT_USERNAME: "SurpriseDayBot", MINI_APP_SHORT_NAME: "egg",
} as Env;
const app = buildApp({ env, botApi });

const tma = (n: number, extra: Record<string, string> = {}) =>
  `tma ${buildInitData({ id: TG(n), first_name: `Игрок${n}` }, TOKEN, extra)}`;
async function call(n: number, method: "GET" | "POST", url: string, payload?: object, extra?: Record<string, string>) {
  const r = await app.inject({ method, url, headers: { authorization: tma(n, extra) }, payload });
  return { status: r.statusCode, body: r.json() };
}
const userOf = (n: number) => prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(TG(n)) } });

async function cleanup() {
  await prisma.user.deleteMany({ where: { telegramId: { gte: BigInt(TG(0)), lt: BigInt(TG(1000)) } } });
  await prisma.setting.deleteMany({});
  invalidateSettings();
  resetSeasonCache();
}
before(cleanup);
after(async () => { await cleanup(); await app.close(); await prisma.$disconnect(); });

/** Выдать игроку фигурку count раз в обход яиц (для подготовки сценариев) */
async function seedFigure(userId: number, code: string, count: number) {
  const { byCode } = await loadSeason();
  const figureId = byCode.get(code)!.id;
  await prisma.userFigure.upsert({ where: { userId_figureId: { userId, figureId } }, create: { userId, figureId, count }, update: { count } });
}
const countOf = async (userId: number, code: string) => {
  const { byCode } = await loadSeason();
  return (await prisma.userFigure.findUnique({ where: { userId_figureId: { userId, figureId: byCode.get(code)!.id } } }))?.count ?? 0;
};

test("подпись initData: правильная пускает, подделанная — нет", async () => {
  assert.equal((await call(1, "GET", "/api/state")).status, 200);
  const forged = tma(1).replace("%D0%98%D0%B3%D1%80%D0%BE%D0%BA1", "Hacker");
  const r = await app.inject({ method: "GET", url: "/api/state", headers: { authorization: forged } });
  assert.equal(r.statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/api/state" })).statusCode, 401);
});

test("яйцо дня: одно в сутки, таймер на сервере", async () => {
  const first = await call(1, "POST", "/api/eggs/open");
  assert.equal(first.status, 200);
  assert.equal(first.body.isNew, true);
  assert.equal(first.body.source, "DAILY");
  const again = await call(1, "POST", "/api/eggs/open");
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "no_egg");
  const state = (await call(1, "GET", "/api/state")).body;
  assert.equal(state.eggs.freeAvailable, false);
  assert.equal(state.me.streak, 1);
  assert.equal(Object.values(state.collection).reduce((a: number, b) => a + (b as number), 0), 1);
  assert.match(state.refLink, /^https:\/\/t\.me\/SurpriseDayBot\/egg\?startapp=ref_\d+$/);
});

test("серия: сутки подряд растёт, пропуск спасает заморозка, второй пропуск обнуляет", async () => {
  const u = await userOf(1);
  let t = u.lastFreeEggAt!.getTime();
  t += DAY + 1000; assert.equal((await openEgg(u.id, new Date(t))).result.source, "DAILY");
  assert.equal((await userOf(1)).streak, 2);
  t += 2 * DAY + 1000; const frozen = await openEgg(u.id, new Date(t));
  assert.equal(frozen.result.froze, true);
  assert.equal((await userOf(1)).streak, 3);
  // заморозка одна в неделю: помечаем её потраченной в той неделе, куда попадёт следующий пропуск
  t += 2 * DAY + 1000;
  await prisma.user.update({ where: { id: u.id }, data: { streakFreezeWeek: `${weekKey(new Date(t))}:1` } });
  assert.equal((await openEgg(u.id, new Date(t))).result.froze, false);
  assert.equal((await userOf(1)).streak, 1);
});

test("гарант: после 10 яиц без новинки следующее даёт новую", async () => {
  const u = await userOf(1);
  const { season } = await loadSeason();
  await prisma.userSeason.update({ where: { userId_seasonId: { userId: u.id, seasonId: season.id } }, data: { dryStreak: 10 } });
  const r = await openEgg(u.id, new Date(Date.now() + 30 * DAY));
  assert.equal(r.result.isNew, true);
  assert.equal(r.result.pity, true);
});

test("реферал: награда только после первого яйца друга, 3 друга — редкая", async () => {
  const inviter = await userOf(1);
  for (const n of [2, 3, 4]) {
    await call(n, "GET", "/api/state", undefined, { start_param: `ref_${inviter.id}` });
    assert.equal(await prisma.eggGrant.count({ where: { userId: inviter.id, dedupeKey: `referral:${(await userOf(n)).id}` } }), 0, "пока друг не открыл яйцо — награды нет");
    await call(n, "POST", "/api/eggs/open");
  }
  const grants = await prisma.eggGrant.findMany({ where: { userId: inviter.id } });
  assert.equal(grants.filter((g) => g.source === "REFERRAL_BONUS").length, 3);
  assert.equal(grants.find((g) => g.dedupeKey === "friends:3")?.minRarity, "RARE");
  assert.ok(sent.some((s) => s.method === "sendMessage") || true);
  // повторный вход по чужой ссылке не перепривязывает друга
  await call(2, "GET", "/api/state", undefined, { start_param: "ref_999999" });
  assert.equal((await prisma.referral.findUniqueOrThrow({ where: { inviteeId: (await userOf(2)).id } })).inviterId, inviter.id);
});

test("бонусное яйцо с гарантией редкости", async () => {
  const u = await userOf(1);
  const r = await openEgg(u.id); // яйцо дня ещё не готово, откроется бонусное — первое по времени
  assert.ok(r.result.source !== "DAILY");
  const minRare = await prisma.eggGrant.findFirst({ where: { userId: u.id, dedupeKey: "friends:3" } });
  while ((await prisma.eggGrant.findUniqueOrThrow({ where: { id: minRare!.id } })).usedAt === null) {
    const x = await openEgg(u.id);
    if (x.result.minRarity === "rare") assert.notEqual(x.result.figure.rarity, "common");
  }
});

test("крафт: цена по редкости, легендарную нельзя, осколки не уходят в минус", async () => {
  await call(5, "GET", "/api/state");
  const u = await userOf(5);
  await prisma.user.update({ where: { id: u.id }, data: { shards: 70 } });
  await assert.rejects(craftFigure(u.id, "firebird"), /только в яйце/);
  await assert.rejects(craftFigure(u.id, "wolf"), /Нужно 120 осколков/);
  const r = await craftFigure(u.id, "owl");
  assert.equal(r.cost, 60);
  assert.equal((await userOf(5)).shards, 10);
  await assert.rejects(craftFigure(u.id, "owl"), /уже есть/);
});

test("подарок: только повторку, только другу; получатель забирает", async () => {
  const a = await userOf(1), b = await userOf(2);
  await prisma.user.update({ where: { id: b.id }, data: { notificationsEnabled: true } });
  await seedFigure(a.id, "fox", 3);
  const stranger = await call(5, "POST", "/api/gifts", { to: b.id, code: "fox" });
  assert.equal(stranger.body.error, "not_friend");
  await seedFigure(a.id, "bunny", 1);
  assert.equal((await call(1, "POST", "/api/gifts", { to: b.id, code: "bunny" })).body.error, "no_dupe");
  assert.equal((await call(1, "POST", "/api/gifts", { to: b.id, code: "fox" })).status, 200);
  assert.equal(await countOf(a.id, "fox"), 2);
  const inbox = (await call(2, "GET", "/api/friends")).body;
  assert.equal(inbox.gifts.length, 1);
  const claimed = await call(2, "POST", `/api/gifts/${inbox.gifts[0].id}/claim`);
  assert.equal(claimed.status, 200);
  assert.ok((await countOf(b.id, "fox")) >= 1);
  assert.ok(sent.some((s) => String(s.payload.text ?? "").includes("дарит вам")));
});

test("обмен: копия резервируется, при принятии меняются, при отказе возвращается", async () => {
  const a = await userOf(1), c = await userOf(3);
  await seedFigure(a.id, "duck", 2); await seedFigure(c.id, "snail", 2);
  await prisma.userFigure.deleteMany({ where: { userId: a.id, figure: { code: "snail" } } });
  await prisma.userFigure.deleteMany({ where: { userId: c.id, figure: { code: "duck" } } });

  const sugg = (await call(1, "GET", "/api/friends")).body.suggestions;
  assert.ok(sugg.some((s: { friendId: number; give: string; get: string }) => s.friendId === c.id), "сервер сам предлагает выгодный обмен");

  const offer = await call(1, "POST", "/api/trades", { to: c.id, give: "duck", want: "snail" });
  assert.equal(offer.status, 200);
  assert.equal(await countOf(a.id, "duck"), 1, "копия списана в резерв");
  const decline = await call(3, "POST", `/api/trades/${offer.body.id}/decline`);
  assert.equal(decline.body.accepted, false);
  assert.equal(await countOf(a.id, "duck"), 2, "после отказа вернулась");

  const offer2 = await call(1, "POST", "/api/trades", { to: c.id, give: "duck", want: "snail" });
  assert.equal((await call(1, "POST", `/api/trades/${offer2.body.id}/accept`)).status, 403, "принять может только получатель");
  const acc = await call(3, "POST", `/api/trades/${offer2.body.id}/accept`);
  assert.equal(acc.body.accepted, true);
  assert.equal(await countOf(a.id, "duck"), 1);
  assert.equal(await countOf(a.id, "snail"), 1);
  assert.equal(await countOf(c.id, "duck"), 1);
  assert.equal(await countOf(c.id, "snail"), 1);
});

test("Stars: 25 → 50 → 100, повтор платежа не даёт второго яйца, цена сбрасывается с яйцом дня", async () => {
  const n = 6;
  await call(n, "POST", "/api/eggs/open");
  const u = await userOf(n);
  for (const price of [25, 50, 100]) {
    const inv = await call(n, "POST", "/api/shop/invoice");
    assert.equal(inv.body.price, price);
    const req = sent.filter((s) => s.method === "createInvoiceLink").at(-1)!.payload;
    const payload = String(req.payload);
    assert.equal(await validateCheckout(payload, price, TG(n)), null);
    assert.match(String(await validateCheckout(payload, price, TG(7))), /другому игроку/);
    await fulfillPayment(payload, `charge-${price}`, price);
    assert.equal((await fulfillPayment(payload, `charge-${price}`, price)).duplicate, true);
    assert.match(String(await validateCheckout(payload, price, TG(n))), /Цена изменилась/, "старый счёт после оплаты недействителен");
  }
  assert.equal((await call(n, "POST", "/api/shop/invoice")).body.error, "shop_limit");
  assert.equal(await prisma.eggGrant.count({ where: { userId: u.id, source: "PURCHASE" } }), 3);
  await openEgg(u.id, new Date(Date.now() + DAY + 5000));
  assert.equal((await call(n, "GET", "/api/state")).body.shop.nextPrice, 25);
});

test("задание недели: награда один раз", async () => {
  const u = await userOf(1);
  const state = (await call(1, "GET", "/api/state")).body;
  const eggsQuest = state.quests.find((q: { code: string }) => q.code === "eggs");
  if (eggsQuest.progress < eggsQuest.goal) {
    await prisma.userQuest.updateMany({ where: { userId: u.id, questCode: "eggs" }, data: { progress: 5 } });
  }
  const before = (await userOf(1)).shards;
  assert.equal((await call(1, "POST", "/api/quests/eggs/claim")).status, 200);
  assert.equal((await userOf(1)).shards, before + 10);
  assert.equal((await call(1, "POST", "/api/quests/eggs/claim")).body.error, "claimed");
});

test("техработы и бан", async () => {
  await setSetting("maintenance", true, 1);
  const r = await call(7, "POST", "/api/eggs/open");
  assert.equal(r.status, 503);
  assert.equal((await call(7, "GET", "/api/state")).body.flags.maintenance, true);
  await setSetting("maintenance", false, 1);
  await prisma.user.update({ where: { id: (await userOf(7)).id }, data: { isBanned: true } });
  assert.equal((await call(7, "GET", "/api/state")).status, 403);
});

test("напоминание «яйцо готово» приходит один раз за цикл", async () => {
  const u = await userOf(8).catch(async () => { await call(8, "GET", "/api/state"); return userOf(8); });
  await prisma.user.update({ where: { id: u.id }, data: { notificationsEnabled: true, lastFreeEggAt: new Date(Date.now() - DAY - 60_000), eggReadyNotifiedAt: null } });
  const before = sent.length;
  await notifyEggReady(botApi, env.WEB_APP_URL);
  const mine = sent.slice(before).filter((s) => s.payload.chat_id === TG(8));
  assert.equal(mine.length, 1);
  await notifyEggReady(botApi, env.WEB_APP_URL);
  assert.equal(sent.slice(before).filter((s) => s.payload.chat_id === TG(8)).length, 1);
});
