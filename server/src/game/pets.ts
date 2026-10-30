/**
 * Питомец (тамагочи). Питомцем может стать любая фигурка из коллекции, но время идёт только у главного
 * (users.activePet): у остальных показатели и возраст стоят на паузе до следующего выбора.
 * Все показатели пересчитываются на сервере от серверного времени; клиент только показывает.
 */
import type { Pet, Prisma, User } from "@prisma/client";
import { prisma } from "../db.js";
import { GameError, lockUsers } from "./core.js";

type Tx = Prisma.TransactionClient;
const HOUR = 3600_000, DAY = 24 * HOUR;

export const STAGES = [
  { fromDays: 0, name: "Малыш", emoji: "🍼", scale: 0.72, mult: 1 },
  { fromDays: 1, name: "Детёныш", emoji: "🧸", scale: 0.84, mult: 1.1 },
  { fromDays: 3, name: "Подросток", emoji: "🎒", scale: 0.95, mult: 1.2 },
  { fromDays: 7, name: "Взрослый", emoji: "⭐", scale: 1.04, mult: 1.3 },
  { fromDays: 30, name: "Мудрец", emoji: "🦉", scale: 1.12, mult: 1.5 },
];
export const FOOD = {
  berry: { emoji: "🍓", name: "Ягодка", price: 5, food: 15, mood: 0, toy: false },
  cookie: { emoji: "🍪", name: "Печенье", price: 10, food: 30, mood: 5, toy: false },
  cake: { emoji: "🍰", name: "Тортик", price: 25, food: 60, mood: 15, toy: false },
  ball: { emoji: "⚽", name: "Мячик", price: 15, food: 0, mood: 30, toy: true },
} as const;
export type FoodKey = keyof typeof FOOD;
export const GAMES = ["tower", "asmr"] as const;
export type GameId = (typeof GAMES)[number];
export const ENERGY_COST = 15;

const clamp = (v: number) => Math.max(0, Math.min(100, v));
export const needXp = (level: number) => 50 + 50 * level;
const ageMsOf = (p: Pet, now: Date) => p.ageMs + (p.activeSince ? Math.max(0, now.getTime() - p.activeSince.getTime()) : 0);
const stageIdx = (ageMs: number) => STAGES.reduce((i, st, k) => (ageMs / DAY >= st.fromDays ? k : i), 0);
const foodOf = (u: User) => ({ ...(u.petFood as Record<string, number>) });

/** Показатели меняются со временем (в час) */
function tick(p: Pet, now: Date) {
  const h = Math.max(0, (now.getTime() - p.last.getTime()) / HOUR);
  if (h > 0) {
    if (p.asleep) {
      p.energy = clamp(p.energy + 20 * h); p.food = clamp(p.food - 3 * h); p.clean = clamp(p.clean - h);
      if (p.energy >= 100) p.asleep = false;
    } else {
      p.food = clamp(p.food - 6 * h); p.clean = clamp(p.clean - 3 * h);
      p.energy = clamp(p.energy - (stageIdx(ageMsOf(p, now)) === 0 ? 6 : 4) * h);
      p.mood = clamp(p.mood - (5 + (p.food < 20 ? 6 : 0) + (p.clean < 20 ? 4 : 0)) * h);
    }
  }
  p.last = now;
}

type Effects = { coins: number; messages: string[] };
function addXp(p: Pet, n: number, fx: Effects) {
  p.xp += n;
  while (p.xp >= needXp(p.level)) {
    p.xp -= needXp(p.level); p.level++;
    const bonus = 15 * p.level; fx.coins += bonus;
    fx.messages.push(`Уровень ${p.level}! +${bonus} монет` + (p.level === 3 ? ". Новый бантик!" : p.level === 5 ? ". Корона!" : ""));
  }
}
function checkGrowth(p: Pet, now: Date, fx: Effects) {
  const k = stageIdx(ageMsOf(p, now));
  if (k <= p.stage) return;
  p.stage = k;
  const gift = 20 * k; fx.coins += gift;
  fx.messages.push(`Подрос: теперь ${STAGES[k].name} ${STAGES[k].emoji}! +${gift} монет`);
}

export function petView(p: Pet, now: Date) {
  const ageMs = ageMsOf(p, now);
  return {
    code: p.figureCode, level: p.level, xp: p.xp, needXp: needXp(p.level),
    food: p.food, mood: p.mood, clean: p.clean, energy: p.energy, asleep: p.asleep,
    ageMs, stage: stageIdx(ageMs), active: !!p.activeSince,
  };
}
export type PetView = ReturnType<typeof petView>;

/** Блок «питомец» в /api/state */
export async function petState(user: User, now = new Date()) {
  const pets = await prisma.pet.findMany({ where: { userId: user.id } });
  return {
    active: user.activePet, coins: user.coins, food: foodOf(user), gameBest: user.gameBest as Record<string, number>, gamesPlayed: user.gamesPlayed,
    // Показатели главного питомца досчитываем на лету (в БД они обновятся при следующем действии)
    pets: pets.map((p) => { if (p.activeSince) tick(p, now); return petView(p, now); }),
    config: { stages: STAGES, foods: FOOD, energyCost: ENERGY_COST },
  };
}

async function owns(tx: Tx, userId: number, code: string) {
  return !!(await tx.userFigure.findFirst({ where: { userId, count: { gt: 0 }, figure: { code } } }));
}

/** Действие с главным питомцем в транзакции: блокировка игрока, пересчёт времени, рост, сохранение */
async function withPet<T>(userId: number, now: Date, fn: (p: Pet, user: User, fx: Effects, tx: Tx) => Promise<T> | T) {
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.activePet) throw new GameError("no_pet", "Сначала выберите питомца");
    const p = await tx.pet.upsert({
      where: { userId_figureCode: { userId, figureCode: user.activePet } },
      create: { userId, figureCode: user.activePet, last: now, activeSince: now },
      update: {},
    });
    const fx: Effects = { coins: 0, messages: [] };
    tick(p, now); checkGrowth(p, now, fx);
    const result = await fn(p, user, fx, tx);
    const { id, userId: _u, figureCode: _c, createdAt: _d, ...data } = p;
    await tx.pet.update({ where: { id }, data });
    if (fx.coins) await tx.user.update({ where: { id: userId }, data: { coins: { increment: fx.coins } } });
    return { result, pet: petView(p, now), messages: fx.messages };
  });
}

export async function setActivePet(userId: number, code: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await owns(tx, userId, code))) throw new GameError("not_owned", "Этой фигурки нет в коллекции");
    if (user.activePet === code) return { ok: true };
    // Старый питомец уходит на паузу: досчитали показатели и возраст, остановили часы
    if (user.activePet) {
      const old = await tx.pet.findUnique({ where: { userId_figureCode: { userId, figureCode: user.activePet } } });
      if (old) {
        tick(old, now);
        await tx.pet.update({ where: { id: old.id }, data: { food: old.food, mood: old.mood, clean: old.clean, energy: old.energy, asleep: old.asleep, last: now, ageMs: ageMsOf(old, now), activeSince: null } });
      }
    }
    // Новый продолжает с того места, где остановился: время пошло с этой минуты
    await tx.pet.upsert({
      where: { userId_figureCode: { userId, figureCode: code } },
      create: { userId, figureCode: code, last: now, activeSince: now },
      update: { last: now, activeSince: now },
    });
    await tx.user.update({ where: { id: userId }, data: { activePet: code } });
    return { ok: true };
  });
}

export async function buyFood(userId: number, item: FoodKey) {
  const it = FOOD[item];
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.coins < it.price) throw new GameError("no_coins", "Не хватает монет. Их дают за мини-игры");
    const food = foodOf(user); food[item] = (food[item] ?? 0) + 1;
    const u = await tx.user.update({ where: { id: userId }, data: { coins: { decrement: it.price }, petFood: food } });
    return { coins: u.coins, food };
  });
}

export function feedPet(userId: number, item: FoodKey, now = new Date()) {
  const it = FOOD[item];
  return withPet(userId, now, async (p, user, fx, tx) => {
    if (p.asleep) throw new GameError("asleep", "Питомец спит");
    const food = foodOf(user);
    if (!food[item]) throw new GameError("no_food", "Этого нет в запасе. Купите за монеты");
    if (!it.toy && p.food >= 98) throw new GameError("full", "Питомец уже сыт");
    food[item]--;
    p.food = clamp(p.food + it.food); p.mood = clamp(p.mood + it.mood);
    if (it.toy) p.energy = clamp(p.energy - 5);
    addXp(p, it.toy ? 6 : 5, fx);
    await tx.user.update({ where: { id: userId }, data: { petFood: food } });
    return { food };
  });
}

export function washPet(userId: number, now = new Date()) {
  return withPet(userId, now, (p, _u, fx) => {
    if (p.asleep) throw new GameError("asleep", "Питомец спит");
    if (p.clean >= 98) throw new GameError("clean", "Питомец и так чистый");
    p.clean = 100; p.mood = clamp(p.mood + 5); addXp(p, 8, fx);
    return {};
  });
}

export function patPet(userId: number, now = new Date()) {
  return withPet(userId, now, (p, _u, fx) => {
    if (p.asleep) throw new GameError("asleep", "Тсс, питомец спит");
    // Гладить можно сколько угодно, но засчитывается не чаще раза в секунду
    if (p.lastPatAt && now.getTime() - p.lastPatAt.getTime() < 1000) return { counted: false };
    p.lastPatAt = now; p.mood = clamp(p.mood + 3); addXp(p, 1, fx);
    return { counted: true };
  });
}

export function sleepPet(userId: number, asleep: boolean, now = new Date()) {
  return withPet(userId, now, (p, _u, fx) => {
    if (asleep && !p.asleep && p.energy >= 95) throw new GameError("awake", "Питомец бодр и не хочет спать");
    if (!asleep && p.asleep) addXp(p, 3, fx);
    p.asleep = asleep;
    return {};
  });
}

// ---------------------------------------------------------------- мини-игры

/** Сколько очков вообще можно набрать за это время (защита от подделанного результата) */
function maxScore(game: GameId, sec: number) {
  if (game === "tower") return Math.min(500, Math.ceil(sec * 2) * 6); // не больше двух этажей в секунду, до 6 очков за этаж
  return Math.min(300, Math.ceil(sec * 12)); // ASMR: раунд 25 секунд
}
const coinsFor = (game: GameId, score: number) => Math.min(60, game === "tower" ? score : Math.floor(score / 3));

export function startGame(userId: number, game: GameId, now = new Date()) {
  return withPet(userId, now, async (p, _u, _fx, tx) => {
    if (p.asleep) throw new GameError("asleep", "Питомец спит. Сначала разбудите его");
    if (p.energy < ENERGY_COST) throw new GameError("tired", "Питомец устал. Уложите его спать, чтобы восстановить энергию");
    p.energy = clamp(p.energy - ENERGY_COST);
    // Незаконченные прошлые запуски больше не принимаются
    await tx.gameRun.updateMany({ where: { userId, finishedAt: null }, data: { finishedAt: now, score: 0, coins: 0 } });
    const run = await tx.gameRun.create({ data: { userId, game, startedAt: now } });
    return { runId: run.id };
  });
}

export function finishGame(userId: number, runId: number, rawScore: number, now = new Date()) {
  return withPet(userId, now, async (p, user, fx, tx) => {
    const run = await tx.gameRun.findFirst({ where: { id: runId, userId } });
    if (!run || run.finishedAt) throw new GameError("no_run", "Эта игра уже засчитана", 409);
    const game = run.game as GameId;
    const sec = (now.getTime() - run.startedAt.getTime()) / 1000;
    const score = Math.max(0, Math.min(Math.floor(rawScore), maxScore(game, sec)));
    const mult = STAGES[stageIdx(ageMsOf(p, now))].mult;
    const coins = Math.round(coinsFor(game, score) * mult), xp = 8 + Math.floor(coins / 2);
    p.mood = clamp(p.mood + 15); addXp(p, xp, fx);
    fx.coins += coins;
    const best = { ...(user.gameBest as Record<string, number>) };
    const record = score > 0 && (best[game] == null || score > best[game]);
    if (record || best[game] == null) best[game] = Math.max(score, best[game] ?? 0);
    await tx.gameRun.update({ where: { id: run.id }, data: { finishedAt: now, score, coins } });
    await tx.user.update({ where: { id: userId }, data: { gameBest: best, gamesPlayed: { increment: 1 } } });
    return { score, coins, xp, record };
  });
}
