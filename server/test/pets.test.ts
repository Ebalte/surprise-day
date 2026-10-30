/**
 * Питомец: время идёт только у главного, смена питомца ставит старого на паузу, мини-игры
 * засчитываются через старт/финиш с проверкой очков. Запуск: npm test (локальная БД).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Api } from "grammy";
import { prisma } from "../src/db.js";
import { buildApp } from "../src/http/app.js";
import { buildInitData } from "../src/auth/telegram.js";
import { loadSeason, openEgg, resetSeasonCache } from "../src/game/core.js";
import { feedPet, finishGame, setActivePet, startGame, sleepPet } from "../src/game/pets.js";
import type { Env } from "../src/env.js";

const TOKEN = "777:TEST_GAME_BOT";
const TG = (n: number) => 890000 + n;
const botApi = new Api(TOKEN);
botApi.config.use(async () => ({ ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: "private" } } }) as never);
const env = {
  DATABASE_URL: process.env.DATABASE_URL!, BOT_TOKEN: TOKEN, WEB_APP_URL: "https://game.example", PORT: 0, BOT_MODE: "off",
  SESSION_SECRET: "test-secret-test-secret", SESSION_TTL_DAYS: 30, INIT_DATA_MAX_AGE_SEC: 86400, AUTH_MAX_AGE_SEC: 300, DEV_LOGIN: false,
} as Env;
const app = buildApp({ env, botApi });
const tma = (n: number) => `tma ${buildInitData({ id: TG(n), first_name: `Питомец${n}` }, TOKEN)}`;
async function call(n: number, method: "GET" | "POST", url: string, payload?: object) {
  const r = await app.inject({ method, url, headers: { authorization: tma(n) }, payload });
  return { status: r.statusCode, body: r.json() };
}
const userOf = (n: number) => prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(TG(n)) } });
async function seed(userId: number, code: string, count = 1) {
  const figureId = (await loadSeason()).byCode.get(code)!.id;
  await prisma.userFigure.upsert({ where: { userId_figureId: { userId, figureId } }, create: { userId, figureId, count }, update: { count } });
}
const H = 3600_000;

async function cleanup() {
  await prisma.user.deleteMany({ where: { telegramId: { gte: BigInt(TG(0)), lt: BigInt(TG(1000)) } } });
  resetSeasonCache();
}
before(cleanup);
after(async () => { await cleanup(); await app.close(); await prisma.$disconnect(); });

test("первая фигурка из яйца сама становится питомцем", async () => {
  await call(1, "GET", "/api/state");
  const u = await userOf(1);
  const { result } = await openEgg(u.id);
  const s = (await call(1, "GET", "/api/state")).body;
  assert.equal(s.pet.active, result.figure.code);
  assert.equal(s.pet.pets.length, 1);
  assert.equal(s.pet.coins, 40);
});

test("время идёт только у главного питомца", async () => {
  await call(2, "GET", "/api/state");
  const u = await userOf(2);
  await seed(u.id, "fox"); await seed(u.id, "bunny");
  const t0 = new Date("2026-11-01T10:00:00Z");
  await setActivePet(u.id, "fox", t0);
  await setActivePet(u.id, "bunny", new Date(t0.getTime() + 10 * H)); // лиса прожила 10 часов и уснула на паузе
  await setActivePet(u.id, "fox", new Date(t0.getTime() + 34 * H)); // сутки спустя: лиса не постарела
  const fox = await prisma.pet.findUniqueOrThrow({ where: { userId_figureCode: { userId: u.id, figureCode: "fox" } } });
  const bunny = await prisma.pet.findUniqueOrThrow({ where: { userId_figureCode: { userId: u.id, figureCode: "bunny" } } });
  assert.equal(fox.ageMs, 10 * H);
  assert.equal(Math.round(fox.food), 20); // 80 − 6×10 ч, пауза не ела сытость
  assert.equal(bunny.ageMs, 24 * H);
  assert.equal(bunny.activeSince, null);
  // Нельзя выбрать фигурку, которой нет
  assert.equal((await call(2, "POST", "/api/pet/active", { code: "firebird" })).status, 400);
});

test("еда за монеты, кормление и сон", async () => {
  await call(3, "GET", "/api/state");
  const u = await userOf(3);
  await seed(u.id, "frog");
  assert.equal((await call(3, "POST", "/api/pet/active", { code: "frog" })).status, 200);
  const buy = await call(3, "POST", "/api/pet/buy", { item: "cake" });
  assert.equal(buy.body.coins, 15);
  assert.equal((await call(3, "POST", "/api/pet/buy", { item: "cake" })).status, 400); // не хватает монет
  await prisma.pet.updateMany({ where: { userId: u.id }, data: { food: 10 } });
  const fed = await feedPet(u.id, "cake");
  assert.ok(fed.pet.food >= 69);
  await assert.rejects(sleepPet(u.id, true, "own", new Date(Date.now() + 1000)).then(async () => feedPet(u.id, "berry")), /спит/);
});

test("мини-игра: энергия при старте, очки ограничены временем, повторно не засчитать", async () => {
  await call(4, "GET", "/api/state");
  const u = await userOf(4);
  await seed(u.id, "owl");
  const t0 = new Date();
  await setActivePet(u.id, "owl", t0);
  const { result } = await startGame(u.id, "tower", "own", t0);
  const fin = await finishGame(u.id, result.runId, 9999, new Date(t0.getTime() + 5000));
  assert.equal(fin.result.score, 60); // за 5 секунд максимум 10 этажей × 6
  assert.equal(fin.result.coins, 60);
  await assert.rejects(finishGame(u.id, result.runId, 10, new Date(t0.getTime() + 6000)), /засчитана/);
  const s = (await call(4, "GET", "/api/state")).body;
  assert.equal(s.pet.gameBest.tower, 60);
  assert.equal(s.pet.gamesPlayed, 1);
  // Усталый питомец не играет
  await prisma.pet.updateMany({ where: { userId: u.id }, data: { energy: 2 } });
  assert.equal((await call(4, "POST", "/api/games/start", { game: "asmr" })).status, 400);
});

test("сторис: загрузка JPEG и публичная ссылка без входа", async () => {
  await call(5, "GET", "/api/state");
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
  const up = await call(5, "POST", "/api/stories", { image: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
  assert.equal(up.status, 200);
  const r = await app.inject({ method: "GET", url: up.body.url });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["content-type"], "image/jpeg");
  assert.deepEqual(r.rawPayload, jpeg);
  assert.equal((await call(5, "POST", "/api/stories", { image: "data:image/png;base64,AAAA" })).status, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/stories/../../etc.jpg" })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/stories", payload: { image: "x" } })).statusCode, 401);
});

test("ссылка-подарок: получают и старые игроки, каждый один раз, не больше лимита", async () => {
  const promo = await prisma.promoLink.create({ data: { code: "testmetal1", pack: "metal", maxUses: 2, createdBy: 1n } });
  for (const n of [6, 7, 8]) await call(n, "GET", "/api/state");
  const ok = await call(6, "POST", "/api/promo/claim", { code: "testmetal1" });
  assert.equal(ok.status, 200);
  const s = (await call(6, "GET", "/api/state")).body;
  assert.deepEqual(s.pet.style, { owned: ["outfit:metal", "room:metal"], outfit: "metal", room: "metal" });
  assert.equal((await call(6, "POST", "/api/promo/claim", { code: "testmetal1" })).status, 409); // второй раз нельзя
  assert.equal((await call(7, "POST", "/api/promo/claim", { code: "testmetal1" })).status, 200);
  assert.equal((await call(8, "POST", "/api/promo/claim", { code: "testmetal1" })).status, 410); // лимит 2
  assert.equal((await call(8, "POST", "/api/promo/claim", { code: "nosuchcode" })).status, 404);
  // Снять и снова надеть можно только полученное
  assert.equal((await call(6, "POST", "/api/pet/style", { outfit: null, room: "metal" })).status, 200);
  assert.equal((await call(8, "POST", "/api/pet/style", { outfit: "metal", room: null })).status, 400);
  await prisma.promoLink.delete({ where: { id: promo.id } });
});

test("пати: создание, вход по коду, уход вдвоём, серия заботы и командная цель", async () => {
  for (const n of [10, 11, 12]) await call(n, "GET", "/api/state");
  const [a, b] = [await userOf(10), await userOf(11)];
  await seed(a.id, "fox");
  assert.equal((await call(10, "POST", "/api/pair/create", { code: "bear", kind: "couple" })).status, 400); // нет такой фигурки
  const created = await call(10, "POST", "/api/pair/create", { code: "fox", kind: "couple" });
  assert.equal(created.status, 200);
  const code: string = created.body.inviteCode;
  let s = (await call(10, "GET", "/api/state")).body;
  assert.equal(s.pair.role, "owner");
  assert.match(s.pair.inviteLink, new RegExp(`pair[=_]${code}$`));
  assert.equal((await call(10, "POST", "/api/pair/join", { code })).status, 400); // своё приглашение
  const preview = await call(11, "GET", `/api/pair/invite/${code.toLowerCase()}`);
  assert.equal(preview.body.figureCode, "fox");
  assert.equal((await call(11, "POST", "/api/pair/join", { code: code.toLowerCase() })).status, 200);
  assert.equal((await call(12, "POST", "/api/pair/join", { code })).status, 409); // третьему нельзя
  s = (await call(11, "GET", "/api/state")).body;
  assert.equal(s.pair.role, "partner");
  assert.equal(s.pair.inviteCode, null);

  // Оба заботятся в один день — серия 1; на следующий день — 2
  await prisma.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { petFood: { berry: 5 } } });
  const d0 = new Date("2026-11-03T09:00:00Z"), d1 = new Date(d0.getTime() + 24 * H);
  await prisma.pet.updateMany({ where: { pair: { ownerId: a.id } }, data: { last: d0, food: 50 } });
  await feedPet(a.id, "berry", "pair", d0);
  const both = await feedPet(b.id, "berry", "pair", new Date(d0.getTime() + 60_000));
  assert.ok(both.messages.some((m) => /Серия заботы: 1/.test(m)));
  await prisma.pet.updateMany({ where: { pair: { ownerId: a.id } }, data: { food: 50 } });
  await feedPet(b.id, "berry", "pair", d1);
  const second = await feedPet(a.id, "berry", "pair", new Date(d1.getTime() + 60_000));
  assert.ok(second.messages.some((m) => /Серия заботы: 2/.test(m)));

  // Командная цель: оба сыграли, сумма ≥ 300 → по 40 монет каждому, второму уходит уведомление
  await prisma.pet.updateMany({ where: { pair: { ownerId: a.id } }, data: { energy: 100, asleep: false } });
  const coinsB = (await userOf(11)).coins;
  const r1 = await startGame(a.id, "tower", "pair", d1);
  await finishGame(a.id, r1.result.runId, 60, new Date(d1.getTime() + 30_000)); // 60 × 3 = 180 очков команды
  const r2 = await startGame(b.id, "jump", "pair", new Date(d1.getTime() + 60_000));
  const fin = await finishGame(b.id, r2.result.runId, 30, new Date(d1.getTime() + 90_000)); // 30 × 5 = 150
  assert.equal(fin.result.team?.done, true);
  assert.equal(fin.notices[0].userId, a.id);
  assert.ok((await userOf(11)).coins >= coinsB + fin.result.coins + 40); // плюс возможный бонус за уровень питомца

  // Партнёр выходит — питомец остаётся хозяину, код приглашения новый
  assert.equal((await call(11, "POST", "/api/pair/leave")).status, 200);
  s = (await call(10, "GET", "/api/state")).body;
  assert.equal(s.pair.partner, null);
  assert.notEqual(s.pair.inviteCode, code);
  assert.equal((await call(11, "GET", "/api/state")).body.pair, null);
  // Хозяин выходит один — пати и общий питомец удаляются
  await call(10, "POST", "/api/pair/leave");
  assert.equal(await prisma.pair.count({ where: { ownerId: a.id } }), 0);
});

test("рейтинг дня: лучший результат каждого, своё место", async () => {
  for (const n of [13, 14]) await call(n, "GET", "/api/state");
  const [a, b] = [await userOf(13), await userOf(14)];
  const now = new Date();
  await prisma.gameRun.createMany({ data: [
    { userId: a.id, game: "sort", startedAt: now, finishedAt: now, score: 10 },
    { userId: a.id, game: "sort", startedAt: now, finishedAt: now, score: 25 },
    { userId: b.id, game: "sort", startedAt: now, finishedAt: now, score: 40 },
  ] });
  const lb = (await call(13, "GET", "/api/games/sort/leaderboard")).body;
  const mine = lb.rows.find((r: { you: boolean }) => r.you);
  assert.equal(mine.score, 25);
  assert.ok(lb.rows.findIndex((r: { you: boolean }) => r.you) > lb.rows.findIndex((r: { name: string }) => r.name === "Питомец14"));
  assert.equal(lb.me.score, 25);
  assert.equal((await call(13, "GET", "/api/games/nope/leaderboard")).status, 400);
});

test("напоминания: о каждой нужде один раз, сброс после ухода, тишина ночью", async () => {
  const { needsOf } = await import("../src/bot/pet-reminders.js");
  await call(15, "GET", "/api/state");
  const u = await userOf(15);
  await seed(u.id, "duck");
  const t0 = new Date("2026-11-05T09:00:00Z"); // 12:00 по Москве
  await setActivePet(u.id, "duck", t0);
  const pet = await prisma.pet.findFirstOrThrow({ where: { userId: u.id } });
  const later = needsOf(pet, new Date(t0.getTime() + 10 * H)); // 80 − 60 = 20 сытости
  assert.equal(later.on.food, true);
  assert.equal(later.on.clean, false);
  const { notifyPets } = await import("../src/bot/pet-reminders.js");
  const texts: string[] = [];
  const api = new Api("1:x"); api.config.use(async (_p, method, payload) => { if (method === "sendMessage") texts.push((payload as { text: string }).text); return { ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: "private" } } } as never; });
  await prisma.user.update({ where: { id: u.id }, data: { notificationsEnabled: true } });
  const at = new Date(t0.getTime() + 10 * H); // 22:00 по Москве
  await notifyPets(api, "https://game.example", at, async () => "Утёнок Плюх");
  assert.ok(texts.some((t) => /Утёнок Плюх:\n🍓 хочет есть/.test(t)));
  const n = texts.length;
  await notifyPets(api, "https://game.example", new Date(at.getTime() + 4 * H), async () => "Утёнок Плюх"); // 02:00 — ночь, молчим
  await notifyPets(api, "https://game.example", new Date(at.getTime() + 0.5 * H), async () => "Утёнок Плюх"); // уже писали
  assert.equal(texts.length, n);
});

test("рекорд засчитывается полностью, игра стоит 3 энергии, за сторис с рекордом — одно яйцо в день", async () => {
  await call(16, "GET", "/api/state");
  const u = await userOf(16);
  await seed(u.id, "bear");
  const t0 = new Date();
  await setActivePet(u.id, "bear", t0);
  const st = await startGame(u.id, "asmr", "own", t0);
  assert.equal(Math.round(st.pet.energy), 77); // 80 − 3
  const fin = await finishGame(u.id, st.result.runId, 420, new Date(t0.getTime() + 25_000));
  assert.equal(fin.result.score, 420); // 400+ за 25 секунд ASMR засчитываются
  assert.equal(fin.result.record, true);
  assert.equal((await userOf(16)).gameBest && ((await userOf(16)).gameBest as Record<string, number>).asmr, 420);

  const jpeg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50, 1)]).toString("base64")}`;
  const first = await call(16, "POST", "/api/stories", { image: jpeg, runId: fin.result.runId });
  assert.equal(first.body.egg, true);
  assert.equal(await prisma.eggGrant.count({ where: { userId: u.id, source: "STORY" } }), 1);
  // Та же игра ещё раз и вторая сторис за день — без яйца
  assert.equal((await call(16, "POST", "/api/stories", { image: jpeg, runId: fin.result.runId })).body.egg, false);
  const st2 = await startGame(u.id, "asmr", "own", new Date(t0.getTime() + 60_000));
  const fin2 = await finishGame(u.id, st2.result.runId, 500, new Date(t0.getTime() + 90_000));
  assert.equal(fin2.result.record, true);
  assert.equal((await call(16, "POST", "/api/stories", { image: jpeg, runId: fin2.result.runId })).body.egg, false);
  // Чужая игра не даёт яйцо
  await call(17, "GET", "/api/state");
  assert.equal((await call(17, "POST", "/api/stories", { image: jpeg, runId: fin2.result.runId })).body.egg, false);
});
