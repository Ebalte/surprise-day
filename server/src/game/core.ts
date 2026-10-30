/**
 * Ядро игры. Всё, что меняет прогресс игрока, выполняется в транзакции
 * с блокировкой строки users (SELECT ... FOR UPDATE), поэтому два одновременных
 * запроса не откроют одно яйцо дважды и не потратят осколки дважды.
 */
import { randomBytes } from "node:crypto";
import type { DropSource, Figure, Prisma, Rarity, User } from "@prisma/client";
import { prisma } from "../db.js";
import { getActiveSeason, type StoredRules } from "../seasons/active.js";
import { effectiveRules } from "../settings/service.js";
import type { RarityKey, Reward } from "../seasons/config.js";

export type Tx = Prisma.TransactionClient;
export const DAY = 86400_000;
export const ORDER: RarityKey[] = ["common", "rare", "epic", "legendary"];
export const rk = (r: Rarity) => r.toLowerCase() as RarityKey;
export const RK = (r: RarityKey) => r.toUpperCase() as Rarity;

export class GameError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** Равномерное случайное число [0, 1) из криптостойкого генератора */
export const rand = () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48;

export function pickWeighted<T>(items: T[], weight: (x: T) => number): T {
  const total = items.reduce((s, x) => s + weight(x), 0);
  let r = rand() * total;
  for (const x of items) {
    r -= weight(x);
    if (r < 0) return x;
  }
  return items[items.length - 1];
}

/** Понедельник недели (UTC) в формате YYYY-MM-DD — ключ недели для заданий и заморозок */
export function weekKey(now = new Date()) {
  const back = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back)).toISOString().slice(0, 10);
}
export const weekEndsAt = (now = new Date()) => new Date(Date.parse(weekKey(now) + "T00:00:00Z") + 7 * DAY);

// ------------------------------------------------------------------ контекст сезона

type Album = {
  rows: { figures: string[]; reward: Reward }[];
  sets: { code: string; title: string; rarity?: RarityKey; frame: { code: string; title: string; color: string } }[];
};
export type SeasonCtx = Awaited<ReturnType<typeof loadSeason>>;

let figCache: { at: number; seasonId: number; figures: Figure[] } | null = null;

export async function loadSeason(now = new Date()) {
  const season = await getActiveSeason();
  const rules = await effectiveRules(season.rules);
  if (!figCache || figCache.seasonId !== season.id || Date.now() - figCache.at > 30_000) {
    const figures = await prisma.figure.findMany({ where: { seasonId: season.id }, orderBy: { sortOrder: "asc" } });
    figCache = { at: Date.now(), seasonId: season.id, figures };
  }
  const figures = figCache.figures;
  const main = figures.filter((f) => !f.eventSlug && f.isEnabled);
  const events = (rules.events ?? []).map((e) => ({
    ...e,
    active: new Date(e.startsAt) <= now && now < new Date(e.endsAt),
    figures: figures.filter((f) => f.eventSlug === e.slug && f.isEnabled),
  }));
  const album = (rules.album ?? { rows: [], sets: [] }) as Album;
  return { season, rules, figures, main, events, album, byCode: new Map(figures.map((f) => [f.code, f])) };
}

export function resetSeasonCache() {
  figCache = null;
}

// ------------------------------------------------------------------ блокировки и мелочи

export async function lockUsers(tx: Tx, ...ids: number[]) {
  // По возрастанию id — чтобы две встречные транзакции (подарок туда и обратно) не взаимоблокировались
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
  }
}

export async function addGrants(tx: Tx, userId: number, grants: { source: DropSource; dedupeKey: string; minRarity?: RarityKey | null }[]) {
  if (!grants.length) return 0;
  const r = await tx.eggGrant.createMany({
    data: grants.map((g) => ({ userId, source: g.source, dedupeKey: g.dedupeKey, minRarity: g.minRarity ? RK(g.minRarity) : null })),
    skipDuplicates: true, // повторная выдача той же награды игнорируется
  });
  return r.count;
}

export async function ownedMap(tx: Tx | typeof prisma, userId: number, seasonId: number) {
  const rows = await tx.userFigure.findMany({ where: { userId, figure: { seasonId } }, include: { figure: { select: { code: true } } } });
  return new Map(rows.map((r) => [r.figure.code, r.count]));
}

export type QuestEvent = "egg_opened" | "new_figure" | "gift_sent" | "trade_done";
export async function bumpQuests(tx: Tx, ctx: SeasonCtx, userId: number, event: QuestEvent, now = new Date()) {
  const wk = weekKey(now);
  for (const q of ctx.rules.quests.filter((x) => x.event === event)) {
    await tx.userQuest.upsert({
      where: { userId_weekKey_questCode: { userId, weekKey: wk, questCode: q.code } },
      create: { userId, weekKey: wk, questCode: q.code, progress: 1 },
      update: { progress: { increment: 1 } },
    });
  }
}

// ------------------------------------------------------------------ награды

/** Ряды альбома, наборы (рамки), коллекции событий. Возвращает тексты полученных наград. */
async function checkRewards(tx: Tx, ctx: SeasonCtx, userId: number): Promise<string[]> {
  const owned = await ownedMap(tx, userId, ctx.season.id);
  const done = new Set((await tx.userReward.findMany({ where: { userId, seasonId: ctx.season.id } })).map((r) => r.code));
  const msgs: string[] = [];
  const claim = async (code: string) => {
    if (done.has(code)) return false;
    const r = await tx.userReward.createMany({ data: [{ userId, seasonId: ctx.season.id, code }], skipDuplicates: true });
    return r.count > 0;
  };
  const give = async (reward: Reward | undefined, key: string) => {
    if (!reward) return "";
    if (reward.type === "shards") {
      await tx.user.update({ where: { id: userId }, data: { shards: { increment: reward.amount } } });
      return `${reward.amount} осколков`;
    }
    await addGrants(tx, userId, [{ source: key.startsWith("event") ? "EVENT_REWARD" : "ALBUM_ROW", dedupeKey: `${key}:${ctx.season.id}`, minRarity: reward.minRarity }]);
    return reward.minRarity ? `яйцо «${reward.minRarity === "rare" ? "редкая" : "эпическая"} или лучше»` : "бонусное яйцо";
  };

  for (const [i, row] of ctx.album.rows.entries()) {
    if (row.figures.every((c) => owned.get(c)) && (await claim(`row:${i}`))) {
      msgs.push(`Ряд ${i + 1} альбома собран: ${await give(row.reward, `row:${i}`)}`);
    }
  }
  for (const set of ctx.album.sets) {
    const codes = ctx.main.filter((f) => !set.rarity || rk(f.rarity) === set.rarity).map((f) => f.code);
    if (codes.length && codes.every((c) => owned.get(c)) && (await claim(`set:${set.code}`))) {
      await tx.userBadge.createMany({ data: [{ userId, kind: "frame", code: set.frame.code, title: set.frame.title, icon: set.frame.color, seasonId: ctx.season.id }], skipDuplicates: true });
      msgs.push(`${set.title}: ${set.frame.title.toLowerCase()} для аватарки`);
    }
  }
  for (const ev of ctx.events) {
    if (ev.figureCodes.length && ev.figureCodes.every((c) => owned.get(c)) && (await claim(`event:${ev.slug}`))) {
      await tx.userBadge.createMany({ data: [{ userId, kind: "badge", code: ev.badge.code, title: ev.badge.title, icon: ev.badge.icon ?? null, seasonId: ctx.season.id }], skipDuplicates: true });
      const extra = await give(ev.reward, `event:${ev.slug}`);
      msgs.push(`Событие «${ev.title}» собрано: бейдж «${ev.badge.title}»${extra ? ` и ${extra}` : ""}`);
    }
  }
  return msgs;
}

// ------------------------------------------------------------------ выдача фигурки

export type GiveResult = { isNew: boolean; count: number; shardsDelta: number; completedNow: boolean; rewards: string[] };

/**
 * Единая точка, через которую игрок получает фигурку: из яйца, за осколки, в подарок, обменом.
 * Ведёт счётчики сезона, журнал, проверяет сбор коллекции и награды.
 */
export async function giveFigure(
  tx: Tx, ctx: SeasonCtx, userId: number, figure: Figure, source: DropSource,
  opts: { shardsDelta?: number; pity?: boolean; fromEgg?: boolean; now?: Date } = {},
): Promise<GiveResult> {
  const now = opts.now ?? new Date();
  const existing = await tx.userFigure.findUnique({ where: { userId_figureId: { userId, figureId: figure.id } } });
  const isNew = !existing;
  const count = (existing?.count ?? 0) + 1;
  if (existing) await tx.userFigure.update({ where: { id: existing.id }, data: { count, lastObtainedAt: now } });
  else await tx.userFigure.create({ data: { userId, figureId: figure.id, firstObtainedAt: now, lastObtainedAt: now } });

  const us = await tx.userSeason.upsert({
    where: { userId_seasonId: { userId, seasonId: ctx.season.id } },
    create: { userId, seasonId: ctx.season.id, startedAt: now },
    update: {},
  });
  const uniqueCount = us.uniqueCount + (isNew && !figure.eventSlug ? 1 : 0);
  const completedNow = isNew && !figure.eventSlug && !us.completedAt && uniqueCount >= ctx.main.length;
  await tx.userSeason.update({
    where: { id: us.id },
    data: {
      uniqueCount,
      eggsOpened: opts.fromEgg ? { increment: 1 } : undefined,
      dryStreak: isNew ? 0 : opts.fromEgg ? { increment: 1 } : undefined,
      completedAt: completedNow ? now : undefined,
    },
  });

  const shardsDelta = opts.shardsDelta ?? 0;
  if (shardsDelta) await tx.user.update({ where: { id: userId }, data: { shards: { increment: shardsDelta } } });
  await tx.eggLog.create({
    data: { userId, seasonId: ctx.season.id, figureId: figure.id, source, rarity: figure.rarity, isNew, shardsDelta, pityApplied: !!opts.pity, createdAt: now },
  });
  if (completedNow) {
    await tx.userBadge.createMany({
      data: [{ userId, kind: "badge", code: ctx.season.badgeCode, title: ctx.season.badgeTitle, icon: ctx.season.badgeIcon, seasonId: ctx.season.id, awardedAt: now }],
      skipDuplicates: true,
    });
  }
  if (opts.fromEgg) {
    await bumpQuests(tx, ctx, userId, "egg_opened", now);
    if (isNew) await bumpQuests(tx, ctx, userId, "new_figure", now);
  }
  const rewards = isNew ? await checkRewards(tx, ctx, userId) : [];
  return { isNew, count, shardsDelta, completedNow, rewards };
}

// ------------------------------------------------------------------ серия

function freezesUsed(user: Pick<User, "streakFreezeWeek">, wk: string) {
  const [w, n] = (user.streakFreezeWeek ?? "").split(":");
  return w === wk ? Number(n || 1) : 0;
}
export const freezeAvailable = (user: Pick<User, "streakFreezeWeek">, rules: StoredRules, now = new Date()) =>
  freezesUsed(user, weekKey(now)) < rules.streakFreezesPerWeek;

/** Интервал между бесплатными яйцами в мс (настройка «Время между яйцами», по умолчанию сутки) */
export const eggInterval = (rules: Pick<StoredRules, "eggIntervalHours">) => (rules.eggIntervalHours ?? 24) * 3600_000;

/** Серия живёт два интервала после яйца (для суток — 48 ч); заморозка прощает ещё один пропуск */
export function liveStreak(user: User, rules: StoredRules, now = new Date()) {
  if (!user.lastFreeEggAt) return user.streak;
  const gap = now.getTime() - user.lastFreeEggAt.getTime(), step = eggInterval(rules);
  return gap < 2 * step || (gap < 3 * step && freezeAvailable(user, rules, now)) ? user.streak : 0;
}

export const freeEggAt = (user: Pick<User, "lastFreeEggAt">, rules: Pick<StoredRules, "eggIntervalHours">) =>
  user.lastFreeEggAt ? new Date(user.lastFreeEggAt.getTime() + eggInterval(rules)) : new Date(0);

// ------------------------------------------------------------------ яйцо

function roll(ctx: SeasonCtx, owned: Map<string, number>, minRarity: RarityKey | null, forceNew: boolean, now: Date) {
  if (!forceNew && !minRarity) {
    for (const ev of ctx.events.filter((e) => e.active && e.figures.length)) {
      if (rand() < ev.dropChance) return pickWeighted(ev.figures, (f) => ctx.rules.rarities[rk(f.rarity)]?.weight ?? 0);
    }
  }
  const minIdx = ORDER.indexOf(minRarity ?? "common");
  let pool = ctx.main.filter((f) => ORDER.indexOf(rk(f.rarity)) >= minIdx);
  if (forceNew) {
    const missing = pool.filter((f) => !owned.get(f.code));
    if (missing.length) pool = missing;
  }
  const rarities = ORDER.filter((r) => pool.some((f) => rk(f.rarity) === r) && (ctx.rules.rarities[r]?.weight ?? 0) > 0);
  const rarity = rarities.length ? pickWeighted(rarities, (r) => ctx.rules.rarities[r]!.weight) : rk(pool[0].rarity);
  const inRarity = pool.filter((f) => rk(f.rarity) === rarity);
  return inRarity[Math.floor(rand() * inRarity.length)];
}

export const GRANT_LABEL: Record<DropSource, string> = {
  DAILY: "яйцо дня", STREAK_BONUS: "за серию дней", REFERRAL_BONUS: "за друга", FRIENDS_MILESTONE: "за друзей",
  CRAFT: "", GIFT: "", TRADE: "", ALBUM_ROW: "за ряд альбома", EVENT_REWARD: "за коллекцию события",
  AD: "за рекламу", PURCHASE: "за Stars", ADMIN: "от администратора",
};

export type OpenResult = Awaited<ReturnType<typeof openEgg>>;

export async function openEgg(userId: number, now = new Date()) {
  const ctx = await loadSeason(now);
  const notify: { userId: number; text: string }[] = [];
  const result = await prisma.$transaction(async (tx) => {
    await lockUsers(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const free = now >= freeEggAt(user, ctx.rules);
    const step = eggInterval(ctx.rules);
    let source: DropSource = "DAILY", minRarity: RarityKey | null = null, grantId: number | null = null;
    let streakBonus = false, froze = false;
    const userUpdate: Prisma.UserUpdateInput = { totalEggs: { increment: 1 }, firstEggAt: user.firstEggAt ?? now };

    if (free) {
      const gap = user.lastFreeEggAt ? now.getTime() - user.lastFreeEggAt.getTime() : Infinity;
      let streak = 1;
      if (gap < 2 * step) streak = user.streak + 1;
      else if (gap < 3 * step && freezeAvailable(user, ctx.rules, now)) {
        streak = user.streak + 1;
        froze = true;
        const wk = weekKey(now);
        userUpdate.streakFreezeWeek = `${wk}:${freezesUsed(user, wk) + 1}`;
      }
      Object.assign(userUpdate, { lastFreeEggAt: now, streak, bestStreak: Math.max(user.bestStreak, streak) });
      if (streak % 7 === 0) {
        streakBonus = (await addGrants(tx, userId, [{ source: "STREAK_BONUS", dedupeKey: `streak:${streak}:${now.getTime()}` }])) > 0;
      }
    } else {
      const grant = await tx.eggGrant.findFirst({ where: { userId, usedAt: null }, orderBy: { createdAt: "asc" } });
      if (!grant) throw new GameError("no_egg", "Яйцо ещё не готово", 409);
      source = grant.source;
      minRarity = grant.minRarity ? rk(grant.minRarity) : null;
      grantId = grant.id;
    }

    const us = await tx.userSeason.findUnique({ where: { userId_seasonId: { userId, seasonId: ctx.season.id } } });
    const pity = (us?.dryStreak ?? 0) >= ctx.rules.pityThreshold;
    const owned = await ownedMap(tx, userId, ctx.season.id);
    const figure = roll(ctx, owned, minRarity, pity, now);
    const dupShards = owned.get(figure.code) ? ctx.rules.rarities[rk(figure.rarity)]?.shards ?? 0 : 0;
    // Первая фигурка сразу становится питомцем
    if (!user.activePet) {
      userUpdate.activePet = figure.code;
      await tx.pet.upsert({ where: { userId_figureCode: { userId, figureCode: figure.code } }, create: { userId, figureCode: figure.code, last: now, activeSince: now }, update: { last: now, activeSince: now } });
    }

    await tx.user.update({ where: { id: userId }, data: userUpdate });
    const give = await giveFigure(tx, ctx, userId, figure, source, { shardsDelta: dupShards, pity: pity && !owned.get(figure.code), fromEgg: true, now });
    if (grantId) {
      const log = await tx.eggLog.findFirstOrThrow({ where: { userId }, orderBy: { id: "desc" } });
      await tx.eggGrant.update({ where: { id: grantId }, data: { usedAt: now, eggLogId: log.id } });
    }

    // Первое яйцо игрока засчитывает приглашение — так боты, которые просто перешли по ссылке, наград не приносят
    if (!user.firstEggAt) {
      const ref = await tx.referral.findUnique({ where: { inviteeId: userId } });
      if (ref && !ref.qualifiedAt) {
        await tx.referral.update({ where: { id: ref.id }, data: { qualifiedAt: now } });
        const qualified = await tx.referral.count({ where: { inviterId: ref.inviterId, qualifiedAt: { not: null } } });
        const grants: Parameters<typeof addGrants>[2] = [{ source: "REFERRAL_BONUS", dedupeKey: `referral:${userId}` }];
        if (qualified >= 3) grants.push({ source: "FRIENDS_MILESTONE", dedupeKey: "friends:3", minRarity: "rare" });
        if (qualified >= 10) grants.push({ source: "FRIENDS_MILESTONE", dedupeKey: "friends:10", minRarity: "epic" });
        await addGrants(tx, ref.inviterId, grants);
        const name = user.firstName ?? user.username ?? "Друг";
        notify.push({ userId: ref.inviterId, text: `🎁 ${name} открыл(а) первое яйцо по вашей ссылке. Вам бонусное яйцо!` });
      }
    }

    return {
      figure: { code: figure.code, name: figure.name, rarity: rk(figure.rarity), image: figure.image, description: figure.description, event: figure.eventSlug },
      isNew: give.isNew, count: give.count, shards: dupShards, pity: pity && give.isNew,
      source, label: GRANT_LABEL[source], minRarity, streakBonus, froze, completedNow: give.completedNow, rewards: give.rewards,
    };
  });
  return { result, notify };
}

export async function craftFigure(userId: number, code: string, now = new Date()) {
  const ctx = await loadSeason(now);
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, userId);
    const figure = ctx.byCode.get(code);
    if (!figure || figure.eventSlug || !figure.isEnabled) throw new GameError("not_craftable", "Эту фигурку нельзя купить за осколки");
    const cost = ctx.rules.craftCosts[rk(figure.rarity)];
    if (!cost) throw new GameError("not_craftable", "Эту фигурку можно найти только в яйце");
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if ((await ownedMap(tx, userId, ctx.season.id)).get(code)) throw new GameError("owned", "Эта фигурка уже есть");
    if (user.shards < cost) throw new GameError("no_shards", `Нужно ${cost} осколков, у вас ${user.shards}`);
    const give = await giveFigure(tx, ctx, userId, figure, "CRAFT", { shardsDelta: -cost, now });
    return { figure: { code, name: figure.name, rarity: rk(figure.rarity), image: figure.image, description: figure.description, event: null }, cost, ...give };
  });
}
