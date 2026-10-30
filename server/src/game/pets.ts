/**
 * Питомец (тамагочи). Питомцем может стать любая фигурка из коллекции, но время идёт только у главного
 * (users.activePet): у остальных показатели и возраст стоят на паузе до следующего выбора.
 * Все показатели пересчитываются на сервере от серверного времени; клиент только показывает.
 */
import type { Pet, Prisma, User } from "@prisma/client";
import { prisma } from "../db.js";
import { GameError, lockUsers } from "./core.js";
import { cosmeticsState } from "./cosmetics.js";
import { displayName } from "./social.js";

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
export const GAMES = ["tower", "asmr", "rhythm", "sort", "jump"] as const;
export type GameId = (typeof GAMES)[number];
export const ENERGY_COST = 3;

const clamp = (v: number) => Math.max(0, Math.min(100, v));
export const needXp = (level: number) => 50 + 50 * level;
const ageMsOf = (p: Pet, now: Date) => p.ageMs + (p.activeSince ? Math.max(0, now.getTime() - p.activeSince.getTime()) : 0);
const stageIdx = (ageMs: number) => STAGES.reduce((i, st, k) => (ageMs / DAY >= st.fromDays ? k : i), 0);
const foodOf = (u: User) => ({ ...(u.petFood as Record<string, number>) });

/** Показатели меняются со временем (в час) */
export function tick(p: Pet, now: Date) {
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

type Effects = { coins: number; messages: string[]; notices: Notice[] };
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
  pets.sort((a, b) => a.id - b.id);
  return {
    active: user.activePet, coins: user.coins, food: foodOf(user), gameBest: user.gameBest as Record<string, number>, gamesPlayed: user.gamesPlayed,
    // Показатели главного питомца досчитываем на лету (в БД они обновятся при следующем действии)
    pets: pets.map((p) => { if (p.activeSince) tick(p, now); return petView(p, now); }),
    config: { stages: STAGES, foods: FOOD, energyCost: ENERGY_COST },
    style: cosmeticsState(user),
    notify: user.petNotify,
  };
}

async function owns(tx: Tx, userId: number, code: string) {
  return !!(await tx.userFigure.findFirst({ where: { userId, count: { gt: 0 }, figure: { code } } }));
}

/** Чей питомец: свой главный или общий питомец пати */
export type Target = "own" | "pair";
export type Notice = { userId: number; text: string };
type PairRow = Prisma.PairGetPayload<object>;
type Ctx = { tx: Tx; user: User; fx: Effects; pair: PairRow | null; now: Date };

export const mskDay = (d: Date) => new Date(d.getTime() + 3 * HOUR).toISOString().slice(0, 10);
export const mskDayStart = (d: Date) => new Date(Date.parse(mskDay(d) + "T00:00:00Z") - 3 * HOUR);

/** Пати игрока (он хозяин или партнёр) */
export const findPairFor = (tx: Tx | typeof prisma, userId: number) =>
  tx.pair.findFirst({ where: { OR: [{ ownerId: userId }, { partnerId: userId }] } });

/**
 * Действие с питомцем в транзакции: блокировка игрока (и пати), пересчёт времени, рост, сохранение.
 * У общего питомца время идёт всегда; награды получает тот, кто действовал.
 */
async function withPet<T>(userId: number, target: Target, now: Date, fn: (p: Pet, c: Ctx) => Promise<T> | T) {
  const out = await prisma.$transaction(async (tx) => {
    await lockUsers(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    let p: Pet, pair: PairRow | null = null;
    if (target === "pair") {
      pair = await findPairFor(tx, userId);
      if (!pair) throw new GameError("no_pair", "Вы пока не в пати");
      await tx.$queryRaw`SELECT id FROM pairs WHERE id = ${pair.id} FOR UPDATE`;
      p = await tx.pet.findUniqueOrThrow({ where: { id: pair.petId } });
    } else {
      if (!user.activePet) throw new GameError("no_pet", "Сначала выберите питомца");
      p = await tx.pet.upsert({
        where: { userId_figureCode: { userId, figureCode: user.activePet } },
        create: { userId, figureCode: user.activePet, last: now, activeSince: now },
        update: {},
      });
    }
    const fx: Effects = { coins: 0, messages: [], notices: [] };
    tick(p, now); checkGrowth(p, now, fx);
    const result = await fn(p, { tx, user, fx, pair, now });
    const { id, userId: _u, figureCode: _c, createdAt: _d, notified: _n, lastNotifyAt: _l, ...data } = p;
    await tx.pet.update({ where: { id }, data });
    if (fx.coins) await tx.user.update({ where: { id: userId }, data: { coins: { increment: fx.coins } } });
    return { result, pet: petView(p, now), messages: fx.messages, notices: fx.notices };
  });
  return out;
}

/** Общий питомец: запись в журнал и отметка «позаботился сегодня» (+ серия заботы, когда оба) */
async function careForPair(c: Ctx, p: Pet, action: string | null) {
  const { tx, pair, user, fx, now } = c;
  if (!pair) return;
  if (action) await tx.petLog.create({ data: { petId: p.id, userId: user.id, action, createdAt: now } });
  const day = mskDay(now), isOwner = pair.ownerId === user.id;
  const d = await tx.pairDay.upsert({ where: { pairId_day: { pairId: pair.id, day } }, create: { pairId: pair.id, day }, update: {} });
  if (isOwner ? d.ownerCared : d.partnerCared) return;
  const upd = await tx.pairDay.update({ where: { id: d.id }, data: isOwner ? { ownerCared: true } : { partnerCared: true } });
  const other = isOwner ? pair.partnerId : pair.ownerId;
  if (!other || !upd.ownerCared || !upd.partnerCared) return;
  // Сегодня позаботились оба — серия растёт, если вчера тоже оба
  const y = await tx.pairDay.findUnique({ where: { pairId_day: { pairId: pair.id, day: mskDay(new Date(now.getTime() - DAY)) } } });
  const streak = y?.ownerCared && y?.partnerCared ? pair.careStreak + 1 : 1;
  await tx.pair.update({ where: { id: pair.id }, data: { careStreak: streak } });
  pair.careStreak = streak;
  fx.messages.push(`Сегодня о питомце позаботились оба 💞 Серия заботы: ${streak}`);
  if (streak % 7 === 0) {
    fx.coins += STREAK_REWARD;
    await tx.user.update({ where: { id: other }, data: { coins: { increment: STREAK_REWARD } } });
    fx.notices.push({ userId: other, text: `🔥 ${streak} дней подряд вы оба заботитесь об общем питомце! +${STREAK_REWARD} монет каждому.` });
    fx.messages.push(`${streak} дней подряд! +${STREAK_REWARD} монет каждому`);
  }
}
export const STREAK_REWARD = 100, TEAM_GOAL = 300, TEAM_COINS = 40, TEAM_XP = 30, DAY_MS = DAY;

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

export function feedPet(userId: number, item: FoodKey, target: Target = "own", now = new Date()) {
  const it = FOOD[item];
  return withPet(userId, target, now, async (p, c) => {
    const { user, fx, tx } = c;
    if (p.asleep) throw new GameError("asleep", "Питомец спит");
    const food = foodOf(user);
    if (!food[item]) throw new GameError("no_food", "Этого нет в запасе. Купите за монеты");
    if (!it.toy && p.food >= 98) throw new GameError("full", "Питомец уже сыт");
    food[item]--;
    p.food = clamp(p.food + it.food); p.mood = clamp(p.mood + it.mood);
    if (it.toy) p.energy = clamp(p.energy - 5);
    addXp(p, it.toy ? 6 : 5, fx);
    await tx.user.update({ where: { id: userId }, data: { petFood: food } });
    await careForPair(c, p, it.toy ? "toy" : "feed");
    return { food };
  });
}

export function washPet(userId: number, target: Target = "own", now = new Date()) {
  return withPet(userId, target, now, async (p, c) => {
    if (p.asleep) throw new GameError("asleep", "Питомец спит");
    if (p.clean >= 98) throw new GameError("clean", "Питомец и так чистый");
    p.clean = 100; p.mood = clamp(p.mood + 5); addXp(p, 8, c.fx);
    await careForPair(c, p, "wash");
    return {};
  });
}

export function patPet(userId: number, target: Target = "own", now = new Date()) {
  return withPet(userId, target, now, async (p, c) => {
    if (p.asleep) throw new GameError("asleep", "Тсс, питомец спит");
    // Гладить можно сколько угодно, но засчитывается не чаще раза в секунду
    if (p.lastPatAt && now.getTime() - p.lastPatAt.getTime() < 1000) return { counted: false };
    p.lastPatAt = now; p.mood = clamp(p.mood + 3); addXp(p, 1, c.fx);
    await careForPair(c, p, null); // поглаживания в журнал не пишем — их слишком много
    return { counted: true };
  });
}

export function sleepPet(userId: number, asleep: boolean, target: Target = "own", now = new Date()) {
  return withPet(userId, target, now, async (p, c) => {
    if (asleep && !p.asleep && p.energy >= 95) throw new GameError("awake", "Питомец бодр и не хочет спать");
    const changed = asleep !== p.asleep;
    if (!asleep && p.asleep) addXp(p, 3, c.fx);
    p.asleep = asleep;
    if (changed) await careForPair(c, p, asleep ? "sleep" : "wake");
    return {};
  });
}

// ---------------------------------------------------------------- мини-игры

/**
 * Правила игр для проверки результата: максимум очков за время игры (защита от подделки),
 * монеты за очки (не больше 60 за игру) и очки для командной цели пати.
 */
const GAME_RULES: Record<GameId, { max: (sec: number) => number; coins: (score: number) => number; team: (score: number) => number }> = {
  tower: { max: (s) => Math.ceil(s * 2) * 6, coins: (x) => x, team: (x) => x * 3 }, // ≤ 2 этажа в секунду, до 6 очков за этаж
  asmr: { max: (s) => Math.ceil(s * 40), coins: (x) => Math.floor(x / 5), team: (x) => x }, // быстрый свайп лопает целый ряд за миг
  rhythm: { max: (s) => Math.ceil(s * 3) * 4, coins: (x) => Math.floor(x / 5), team: (x) => Math.floor(x / 2) }, // ≤ 3 ноты в секунду, до 4 очков за ноту
  sort: { max: (s) => Math.ceil(s * 3), coins: (x) => x, team: (x) => x * 3 }, // ≤ 3 вкусняшки в секунду
  jump: { max: (s) => Math.ceil(s * 5), coins: (x) => x, team: (x) => x * 4 }, // препятствие + ягода (+2) чаще раза в секунду
};

export function startGame(userId: number, game: GameId, target: Target = "own", now = new Date()) {
  return withPet(userId, target, now, async (p, { tx, pair }) => {
    if (p.asleep) throw new GameError("asleep", "Питомец спит. Сначала разбудите его");
    if (p.energy < ENERGY_COST) throw new GameError("tired", "Питомец устал. Уложите его спать, чтобы восстановить энергию");
    p.energy = clamp(p.energy - ENERGY_COST);
    // Незаконченные прошлые запуски больше не принимаются
    await tx.gameRun.updateMany({ where: { userId, finishedAt: null }, data: { finishedAt: now, score: 0, coins: 0 } });
    const run = await tx.gameRun.create({ data: { userId, game, startedAt: now, pairId: pair?.id ?? null } });
    return { runId: run.id };
  });
}

export async function finishGame(userId: number, runId: number, rawScore: number, now = new Date()) {
  const r0 = await prisma.gameRun.findFirst({ where: { id: runId, userId } });
  if (!r0 || r0.finishedAt) throw new GameError("no_run", "Эта игра уже засчитана", 409);
  return withPet(userId, r0.pairId ? "pair" : "own", now, async (p, c) => {
    const { tx, user, fx, pair } = c;
    const run = await tx.gameRun.findFirst({ where: { id: runId, userId } });
    if (!run || run.finishedAt) throw new GameError("no_run", "Эта игра уже засчитана", 409);
    const game = run.game as GameId, rules = GAME_RULES[game];
    const sec = (now.getTime() - run.startedAt.getTime()) / 1000;
    const score = Math.max(0, Math.min(Math.floor(rawScore), rules.max(sec)));
    const mult = STAGES[stageIdx(ageMsOf(p, now))].mult;
    const coins = Math.round(Math.min(60, rules.coins(score)) * mult), xp = 8 + Math.floor(coins / 2);
    p.mood = clamp(p.mood + 15); addXp(p, xp, fx);
    fx.coins += coins;
    const best = { ...(user.gameBest as Record<string, number>) };
    const record = score > 0 && (best[game] == null || score > best[game]);
    if (record || best[game] == null) best[game] = Math.max(score, best[game] ?? 0);
    await tx.gameRun.update({ where: { id: run.id }, data: { finishedAt: now, score, coins, record } });
    await tx.user.update({ where: { id: userId }, data: { gameBest: best, gamesPlayed: { increment: 1 } } });
    let team: { points: number; total: number; done: boolean } | null = null;
    if (pair && pair.id === run.pairId) {
      await careForPair(c, p, "game");
      team = await addTeamPoints(c, p, rules.team(score));
    }
    return { runId: run.id, score, coins, xp, record, team };
  });
}

/** Командная цель дня пати: сумма очков обоих в совместных играх. Оба должны сыграть хотя бы раз. */
async function addTeamPoints(c: Ctx, p: Pet, points: number) {
  const { tx, pair, user, fx, now } = c;
  const isOwner = pair!.ownerId === user.id;
  const d = await tx.pairDay.update({
    where: { pairId_day: { pairId: pair!.id, day: mskDay(now) } },
    data: isOwner ? { ownerPoints: { increment: points } } : { partnerPoints: { increment: points } },
  });
  const total = d.ownerPoints + d.partnerPoints;
  const other = isOwner ? pair!.partnerId : pair!.ownerId;
  if (!d.teamRewarded && other && d.ownerPoints > 0 && d.partnerPoints > 0 && total >= TEAM_GOAL) {
    await tx.pairDay.update({ where: { id: d.id }, data: { teamRewarded: true } });
    fx.coins += TEAM_COINS; addXp(p, TEAM_XP, fx);
    await tx.user.update({ where: { id: other }, data: { coins: { increment: TEAM_COINS } } });
    fx.messages.push(`Командная цель дня выполнена! +${TEAM_COINS} монет каждому`);
    fx.notices.push({ userId: other, text: `🏆 Командная цель дня выполнена! Вы вместе набрали ${total} очков. +${TEAM_COINS} монет каждому.` });
    return { points, total, done: true };
  }
  return { points, total, done: d.teamRewarded };
}

/** Рейтинг дня по игре (сутки по Москве): лучший результат каждого игрока */
export async function gameLeaderboard(userId: number, game: GameId, now = new Date()) {
  const start = mskDayStart(now);
  const rows = await prisma.$queryRaw<{ userId: number; score: number; firstName: string | null; lastName: string | null; username: string | null }[]>`
    SELECT r."userId", MAX(r.score)::int AS score, u."firstName", u."lastName", u."username"
    FROM game_runs r JOIN users u ON u.id = r."userId"
    WHERE r.game = ${game} AND r."finishedAt" >= ${start} AND r.score > 0 AND NOT u."isBanned"
    GROUP BY r."userId", u.id
    ORDER BY score DESC, MIN(r."finishedAt") ASC
    LIMIT 10`;
  const [mine] = await prisma.$queryRaw<{ score: number | null }[]>`
    SELECT MAX(score)::int AS score FROM game_runs WHERE game = ${game} AND "userId" = ${userId} AND "finishedAt" >= ${start} AND score > 0`;
  const [{ above, total }] = await prisma.$queryRaw<{ above: number; total: number }[]>`
    WITH best AS (SELECT "userId", MAX(score) AS s FROM game_runs WHERE game = ${game} AND "finishedAt" >= ${start} AND score > 0 GROUP BY "userId")
    SELECT COUNT(*) FILTER (WHERE s > ${mine?.score ?? 0})::int AS above, COUNT(*)::int AS total FROM best`;
  const pair = await findPairFor(prisma, userId);
  const partnerId = pair ? (pair.ownerId === userId ? pair.partnerId : pair.ownerId) : null;
  return {
    rows: rows.map((r, i) => ({ place: i + 1, name: displayName(r), score: r.score, you: r.userId === userId, partner: r.userId === partnerId })),
    me: mine?.score ? { place: above + 1, score: mine.score } : null,
    total,
  };
}
