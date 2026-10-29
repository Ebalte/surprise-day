/** Всё, что нужно фронту для отрисовки игры, одним запросом */
import type { User } from "@prisma/client";
import { prisma } from "../db.js";
import { getFlag } from "../settings/service.js";
import { pickAd } from "../ads/service.js";
import { startOfUtcDay } from "../db.js";
import { GRANT_LABEL, freeEggAt, freezeAvailable, liveStreak, loadSeason, ownedMap, rk, weekEndsAt, weekKey } from "./core.js";
import { shopState } from "./shop.js";
import { displayName } from "./social.js";
import { GameError } from "./core.js";

export function refLink(userId: number, e: { BOT_USERNAME?: string; MINI_APP_SHORT_NAME?: string; WEB_APP_URL: string }) {
  if (e.BOT_USERNAME && e.MINI_APP_SHORT_NAME) return `https://t.me/${e.BOT_USERNAME}/${e.MINI_APP_SHORT_NAME}?startapp=ref_${userId}`;
  return `${e.WEB_APP_URL.replace(/\/$/, "")}/?ref=${userId}`;
}

export async function gameState(user: User, links: Parameters<typeof refLink>[1], now = new Date()) {
  const ctx = await loadSeason(now);
  const { rules } = ctx;
  const [owned, us, grants, quests, rewards, badges, shop, maintenance, adsOn, adEggs, rewardedAd] = await Promise.all([
    ownedMap(prisma, user.id, ctx.season.id),
    prisma.userSeason.findUnique({ where: { userId_seasonId: { userId: user.id, seasonId: ctx.season.id } } }),
    prisma.eggGrant.findMany({ where: { userId: user.id, usedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.userQuest.findMany({ where: { userId: user.id, weekKey: weekKey(now) } }),
    prisma.userReward.findMany({ where: { userId: user.id, seasonId: ctx.season.id } }),
    prisma.userBadge.findMany({ where: { userId: user.id } }),
    shopState(user),
    getFlag("maintenance"),
    getFlag("ads.enabled"),
    prisma.eggGrant.count({ where: { userId: user.id, source: "AD", createdAt: { gte: startOfUtcDay(now) } } }),
    pickAd("REWARDED", now),
  ]);
  const qmap = new Map(quests.map((q) => [q.questCode, q]));
  const rewardCodes = new Set(rewards.map((r) => r.code));
  return {
    serverTime: now.toISOString(),
    flags: { maintenance },
    me: {
      id: user.id, name: displayName(user), username: user.username, photoUrl: user.photoUrl,
      shards: user.shards, streak: liveStreak(user, rules, now), bestStreak: user.bestStreak, totalEggs: user.totalEggs,
      freezeAvailable: freezeAvailable(user, rules, now), notificationsEnabled: user.notificationsEnabled, activeFrame: user.activeFrame,
    },
    season: {
      slug: ctx.season.slug, title: ctx.season.title,
      badge: { code: ctx.season.badgeCode, title: ctx.season.badgeTitle, icon: ctx.season.badgeIcon },
      figures: ctx.figures.filter((f) => f.isEnabled || owned.get(f.code)).map((f) => ({
        code: f.code, name: f.name, rarity: rk(f.rarity), image: f.image, description: f.description, event: f.eventSlug,
      })),
      mainCount: ctx.main.length,
      rules: {
        rarities: rules.rarities, eggIntervalHours: rules.eggIntervalHours, pityThreshold: rules.pityThreshold, pityHintFrom: rules.pityHintFrom,
        craftCosts: rules.craftCosts, trading: rules.trading, streakFreezesPerWeek: rules.streakFreezesPerWeek,
      },
      album: ctx.album,
      events: ctx.events.map((e) => ({ slug: e.slug, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, dropChance: e.dropChance, figureCodes: e.figureCodes, badge: e.badge, active: e.active })),
    },
    collection: Object.fromEntries(owned),
    progress: { dryStreak: us?.dryStreak ?? 0, unique: us?.uniqueCount ?? 0, startedAt: us?.startedAt ?? null, completedAt: us?.completedAt ?? null },
    eggs: {
      freeAvailable: now >= freeEggAt(user, rules), nextFreeAt: freeEggAt(user, rules).toISOString(),
      grants: grants.map((g) => ({ id: g.id, source: g.source, label: GRANT_LABEL[g.source], minRarity: g.minRarity ? rk(g.minRarity) : null })),
    },
    shop,
    ads: { rewarded: adsOn && !!rewardedAd && adEggs < rules.shop.adEggsPerDay, left: Math.max(0, rules.shop.adEggsPerDay - adEggs), perDay: rules.shop.adEggsPerDay },
    quests: rules.quests.map((q) => ({ code: q.code, title: q.title, goal: q.goal, shards: q.shards, progress: Math.min(q.goal, qmap.get(q.code)?.progress ?? 0), claimed: !!qmap.get(q.code)?.claimedAt })),
    weekEndsAt: weekEndsAt(now).toISOString(),
    rewards: {
      rows: ctx.album.rows.map((_, i) => rewardCodes.has(`row:${i}`)),
      sets: ctx.album.sets.map((s) => rewardCodes.has(`set:${s.code}`)),
    },
    badges: badges.filter((b) => b.kind === "badge").map((b) => ({ code: b.code, title: b.title, icon: b.icon, awardedAt: b.awardedAt })),
    frames: badges.filter((b) => b.kind === "frame").map((b) => ({ code: b.code, title: b.title, color: b.icon })),
    refLink: refLink(user.id, links),
  };
}

export async function claimQuest(userId: number, code: string, now = new Date()) {
  const { rules } = await loadSeason(now);
  const q = rules.quests.find((x) => x.code === code);
  if (!q) throw new GameError("no_quest", "Такого задания нет", 404);
  return prisma.$transaction(async (tx) => {
    const row = await tx.userQuest.findUnique({ where: { userId_weekKey_questCode: { userId, weekKey: weekKey(now), questCode: code } } });
    if (!row || row.progress < q.goal) throw new GameError("not_done", "Задание ещё не выполнено");
    const r = await tx.userQuest.updateMany({ where: { id: row.id, claimedAt: null }, data: { claimedAt: now } });
    if (!r.count) throw new GameError("claimed", "Награда уже получена");
    await tx.user.update({ where: { id: userId }, data: { shards: { increment: q.shards } } });
    return { shards: q.shards };
  });
}

export async function setFrame(userId: number, code: string | null) {
  if (code && !(await prisma.userBadge.findFirst({ where: { userId, kind: "frame", code } }))) throw new GameError("no_frame", "Эта рамка ещё не получена");
  await prisma.user.update({ where: { id: userId }, data: { activeFrame: code } });
}

export async function leaderboard(userId: number) {
  const { season } = await loadSeason();
  const rows = await prisma.$queryRaw<{ userId: number; firstName: string | null; lastName: string | null; username: string | null; ms: number; completedAt: Date }[]>`
    SELECT us."userId", u."firstName", u."lastName", u."username", us."completedAt",
           EXTRACT(EPOCH FROM (us."completedAt" - us."startedAt")) * 1000 AS ms
    FROM user_seasons us JOIN users u ON u.id = us."userId"
    WHERE us."seasonId" = ${season.id} AND us."completedAt" IS NOT NULL AND u."isBanned" = false
    ORDER BY ms ASC, us."completedAt" ASC LIMIT 50`;
  return rows.map((r, i) => ({ place: i + 1, name: displayName(r), ms: Number(r.ms), you: r.userId === userId }));
}
