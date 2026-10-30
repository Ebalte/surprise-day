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
  await assert.rejects(sleepPet(u.id, true, new Date(Date.now() + 1000)).then(async () => feedPet(u.id, "berry")), /спит/);
});

test("мини-игра: энергия при старте, очки ограничены временем, повторно не засчитать", async () => {
  await call(4, "GET", "/api/state");
  const u = await userOf(4);
  await seed(u.id, "owl");
  const t0 = new Date();
  await setActivePet(u.id, "owl", t0);
  const { result } = await startGame(u.id, "tower", t0);
  const fin = await finishGame(u.id, result.runId, 9999, new Date(t0.getTime() + 5000));
  assert.equal(fin.result.score, 60); // за 5 секунд максимум 10 этажей × 6
  assert.equal(fin.result.coins, 60);
  await assert.rejects(finishGame(u.id, result.runId, 10, new Date(t0.getTime() + 6000)), /засчитана/);
  const s = (await call(4, "GET", "/api/state")).body;
  assert.equal(s.pet.gameBest.tower, 60);
  assert.equal(s.pet.gamesPlayed, 1);
  // Усталый питомец не играет
  await prisma.pet.updateMany({ where: { userId: u.id }, data: { energy: 5 } });
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
