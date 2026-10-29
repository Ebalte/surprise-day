/**
 * Игроки, друзья, подарки и обмен.
 * Отдавать можно только повторки (count > 1), только друзьям, которые открыли первое яйцо.
 * Копия отправителя списывается сразу (эскроу) и возвращается при отказе, отмене или истечении срока.
 */
import type { Figure, User } from "@prisma/client";
import { prisma } from "../db.js";
import type { TgUser } from "../auth/telegram.js";
import { GameError, bumpQuests, giveFigure, loadSeason, lockUsers, ownedMap, rk, type SeasonCtx, type Tx } from "./core.js";

export const displayName = (u: Pick<User, "firstName" | "lastName" | "username">) =>
  [u.firstName, u.lastName].filter(Boolean).join(" ") || (u.username ? `@${u.username}` : "Игрок");

/** Создаёт или обновляет игрока по данным Telegram. ref — id пригласившего (из start_param ref_<id> или ?ref=). */
export async function upsertTgUser(tg: TgUser, ref?: string | number) {
  const data = {
    username: tg.username ?? null, firstName: tg.first_name ?? null, lastName: tg.last_name ?? null,
    languageCode: tg.language_code ?? null, isPremium: !!tg.is_premium, ...(tg.photo_url ? { photoUrl: tg.photo_url } : {}),
  };
  const existing = await prisma.user.findUnique({ where: { telegramId: BigInt(tg.id) } });
  if (existing) {
    const changed = (Object.keys(data) as (keyof typeof data)[]).some((k) => existing[k] !== data[k]);
    const stale = Date.now() - existing.lastSeenAt.getTime() > 5 * 60_000;
    if (!changed && !stale) return { user: existing, created: false };
    return { user: await prisma.user.update({ where: { id: existing.id }, data: { ...data, lastSeenAt: new Date() } }), created: false };
  }
  let user: User;
  try {
    user = await prisma.user.create({ data: { telegramId: BigInt(tg.id), ...data } });
  } catch {
    // Два первых запроса пришли одновременно — второй просто читает созданного игрока
    return { user: await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(tg.id) } }), created: false };
  }
  const inviterId = Number(String(ref ?? "").replace(/^ref_/, ""));
  if (Number.isInteger(inviterId) && inviterId > 0 && inviterId !== user.id) {
    const inviter = await prisma.user.findUnique({ where: { id: inviterId } });
    if (inviter) await prisma.referral.createMany({ data: [{ inviterId, inviteeId: user.id }], skipDuplicates: true });
  }
  return { user, created: true };
}

/** Друзья — связь через реферала в любую сторону */
async function friendIds(userId: number) {
  const refs = await prisma.referral.findMany({ where: { OR: [{ inviterId: userId }, { inviteeId: userId }] } });
  return refs.map((r) => (r.inviterId === userId ? r.inviteeId : r.inviterId));
}

async function assertFriend(userId: number, otherId: number) {
  if (userId === otherId) throw new GameError("self", "Нельзя отправить самому себе");
  const ids = await friendIds(userId);
  if (!ids.includes(otherId)) throw new GameError("not_friend", "Меняться и дарить можно только с друзьями", 403);
  const other = await prisma.user.findUnique({ where: { id: otherId } });
  if (!other || !other.firstEggAt) throw new GameError("not_qualified", "Друг ещё не открыл первое яйцо");
  if (other.isBanned) throw new GameError("banned", "Этот игрок недоступен", 403);
  return other;
}

const tradeable = (ctx: SeasonCtx, f: Figure) => ctx.rules.trading.tradeableRarities.includes(rk(f.rarity));
const dupes = (ctx: SeasonCtx, owned: Map<string, number>) =>
  ctx.figures.filter((f) => (owned.get(f.code) ?? 0) > 1 && tradeable(ctx, f));

function figureOrFail(ctx: SeasonCtx, code: string) {
  const f = ctx.byCode.get(code);
  if (!f) throw new GameError("no_figure", "Такой фигурки нет");
  if (!tradeable(ctx, f)) throw new GameError("not_tradeable", rk(f.rarity) === "legendary" ? "Легендарную нельзя дарить и обменивать" : "Эту фигурку нельзя передавать");
  return f;
}

async function takeCopy(tx: Tx, userId: number, figure: Figure) {
  const uf = await tx.userFigure.findUnique({ where: { userId_figureId: { userId, figureId: figure.id } } });
  if (!uf || uf.count < 2) throw new GameError("no_dupe", `Лишней «${figure.name}» нет: последнюю копию отдать нельзя`);
  await tx.userFigure.update({ where: { id: uf.id }, data: { count: { decrement: 1 } } });
}
async function returnCopy(tx: Tx, userId: number, figureId: number) {
  await tx.userFigure.update({ where: { userId_figureId: { userId, figureId } }, data: { count: { increment: 1 } } });
}

// ------------------------------------------------------------------ подарки

export async function sendGift(senderId: number, receiverId: number, code: string, now = new Date()) {
  const ctx = await loadSeason(now);
  const receiver = await assertFriend(senderId, receiverId);
  const figure = figureOrFail(ctx, code);
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, senderId);
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const today = await tx.gift.count({ where: { senderId, createdAt: { gte: since } } });
    if (today >= ctx.rules.trading.giftsPerDay) throw new GameError("gift_limit", `Подарков на сегодня больше нет: лимит ${ctx.rules.trading.giftsPerDay} в день`);
    await takeCopy(tx, senderId, figure);
    const gift = await tx.gift.create({ data: { senderId, receiverId, figureId: figure.id, createdAt: now } });
    await bumpQuests(tx, ctx, senderId, "gift_sent", now);
    return { gift, receiver, figure };
  });
}

export async function claimGift(userId: number, giftId: number, now = new Date()) {
  const ctx = await loadSeason(now);
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, userId);
    const gift = await tx.gift.findFirst({ where: { id: giftId, receiverId: userId, claimedAt: null }, include: { figure: true, sender: true } });
    if (!gift) throw new GameError("no_gift", "Подарок не найден или уже получен", 404);
    await tx.gift.update({ where: { id: gift.id }, data: { claimedAt: now } });
    const give = await giveFigure(tx, ctx, userId, gift.figure, "GIFT", { now });
    return { figure: gift.figure, from: displayName(gift.sender), ...give };
  });
}

// ------------------------------------------------------------------ обмен

/** Просроченные предложения закрываются при любом чтении, копия возвращается инициатору */
export async function expireTrades(now = new Date()) {
  const stale = await prisma.trade.findMany({ where: { status: "PENDING", expiresAt: { lte: now } }, take: 100 });
  for (const t of stale) {
    await prisma.$transaction(async (tx) => {
      const r = await tx.trade.updateMany({ where: { id: t.id, status: "PENDING" }, data: { status: "EXPIRED", respondedAt: now } });
      if (r.count) await returnCopy(tx, t.fromUserId, t.giveFigureId);
    });
  }
}

export async function proposeTrade(fromId: number, toId: number, giveCode: string, wantCode: string, now = new Date()) {
  const ctx = await loadSeason(now);
  const to = await assertFriend(fromId, toId);
  const give = figureOrFail(ctx, giveCode), want = figureOrFail(ctx, wantCode);
  if (give.id === want.id) throw new GameError("same", "Нужны разные фигурки");
  const theirs = await ownedMap(prisma, toId, ctx.season.id);
  if ((theirs.get(wantCode) ?? 0) < 2) throw new GameError("no_dupe", `У друга нет лишней «${want.name}»`);
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, fromId);
    const pending = await tx.trade.count({ where: { fromUserId: fromId, toUserId: toId, status: "PENDING" } });
    if (pending >= 3) throw new GameError("too_many", "Дождитесь ответа на прошлые предложения этому другу");
    await takeCopy(tx, fromId, give);
    const trade = await tx.trade.create({
      data: { fromUserId: fromId, toUserId: toId, giveFigureId: give.id, wantFigureId: want.id, createdAt: now, expiresAt: new Date(now.getTime() + ctx.rules.trading.offerTtlHours * 3600_000) },
    });
    return { trade, to, give, want };
  });
}

export async function respondTrade(userId: number, tradeId: number, action: "accept" | "decline" | "cancel", now = new Date()) {
  const ctx = await loadSeason(now);
  const t = await prisma.trade.findUnique({ where: { id: tradeId }, include: { giveFigure: true, wantFigure: true, fromUser: true, toUser: true } });
  if (!t || t.status !== "PENDING") throw new GameError("no_trade", "Предложение уже закрыто", 404);
  if (action === "cancel" ? t.fromUserId !== userId : t.toUserId !== userId) throw new GameError("forbidden", "Это не ваше предложение", 403);
  if (t.expiresAt <= now) {
    await expireTrades(now);
    throw new GameError("expired", "Срок предложения истёк");
  }
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, t.fromUserId, t.toUserId);
    const claimed = await tx.trade.updateMany({
      where: { id: t.id, status: "PENDING" },
      data: { status: action === "accept" ? "ACCEPTED" : action === "decline" ? "DECLINED" : "CANCELLED", respondedAt: now },
    });
    if (!claimed.count) throw new GameError("no_trade", "Предложение уже закрыто", 404);
    if (action !== "accept") {
      await returnCopy(tx, t.fromUserId, t.giveFigureId);
      return { trade: t, accepted: false as const };
    }
    await takeCopy(tx, t.toUserId, t.wantFigure);
    const forMe = await giveFigure(tx, ctx, t.toUserId, t.giveFigure, "TRADE", { now });
    const forThem = await giveFigure(tx, ctx, t.fromUserId, t.wantFigure, "TRADE", { now });
    await bumpQuests(tx, ctx, t.toUserId, "trade_done", now);
    await bumpQuests(tx, ctx, t.fromUserId, "trade_done", now);
    return { trade: t, accepted: true as const, forMe, forThem };
  });
}

// ------------------------------------------------------------------ экран «Друзья»

export async function friendsView(userId: number, now = new Date()) {
  await expireTrades(now);
  const ctx = await loadSeason(now);
  const ids = await friendIds(userId);
  const [friends, mine, gifts, incoming, outgoing, refs] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } } }),
    ownedMap(prisma, userId, ctx.season.id),
    prisma.gift.findMany({ where: { receiverId: userId, claimedAt: null }, include: { figure: true, sender: true }, orderBy: { createdAt: "asc" } }),
    prisma.trade.findMany({ where: { toUserId: userId, status: "PENDING" }, include: { giveFigure: true, wantFigure: true, fromUser: true } }),
    prisma.trade.findMany({ where: { fromUserId: userId }, include: { giveFigure: true, wantFigure: true, toUser: true }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.referral.findMany({ where: { inviterId: userId } }),
  ]);
  const owned = new Map(await Promise.all(friends.map(async (f) => [f.id, await ownedMap(prisma, f.id, ctx.season.id)] as const)));

  // Выгодные обмены «новинка для обоих» — приходят как предложения, без списков «отдам/ищу»
  const busyPairs = new Set([...incoming.map((t) => t.fromUserId), ...outgoing.filter((t) => t.status === "PENDING").map((t) => t.toUserId)]);
  const myDupes = dupes(ctx, mine);
  const suggestions = friends
    .filter((f) => f.firstEggAt && !f.isBanned && !busyPairs.has(f.id))
    .flatMap((f) => {
      const theirs = owned.get(f.id)!;
      const get = dupes(ctx, theirs).find((x) => !mine.get(x.code));
      const give = myDupes.find((x) => !theirs.get(x.code));
      return get && give ? [{ friendId: f.id, name: displayName(f), give: give.code, get: get.code }] : [];
    })
    .slice(0, 3);

  const fig = (f: Figure) => ({ code: f.code, name: f.name, rarity: rk(f.rarity), image: f.image });
  return {
    qualified: refs.filter((r) => r.qualifiedAt).length,
    friends: friends.map((f) => ({
      id: f.id, name: displayName(f), photoUrl: f.photoUrl, qualified: !!f.firstEggAt,
      unique: ctx.main.filter((m) => owned.get(f.id)!.get(m.code)).length, dupes: dupes(ctx, owned.get(f.id)!).length,
      invitedByMe: refs.some((r) => r.inviteeId === f.id),
    })),
    gifts: gifts.map((g) => ({ id: g.id, from: displayName(g.sender), figure: fig(g.figure), isNewForMe: !mine.get(g.figure.code) })),
    incoming: incoming.map((t) => ({ id: t.id, from: displayName(t.fromUser), get: fig(t.giveFigure), pay: fig(t.wantFigure), isNewForMe: !mine.get(t.giveFigure.code), expiresAt: t.expiresAt })),
    outgoing: outgoing.map((t) => ({ id: t.id, to: displayName(t.toUser), give: fig(t.giveFigure), want: fig(t.wantFigure), status: t.status })),
    suggestions,
    myDupes: myDupes.map((f) => ({ ...fig(f), count: mine.get(f.code)! })),
    friendDupes: Object.fromEntries(friends.map((f) => [f.id, dupes(ctx, owned.get(f.id)!).map((x) => ({ ...fig(x), count: owned.get(f.id)!.get(x.code)!, isNewForMe: !mine.get(x.code) }))])),
    friendOwns: Object.fromEntries(friends.map((f) => [f.id, [...owned.get(f.id)!.keys()]])),
    giftsLeft: Math.max(0, ctx.rules.trading.giftsPerDay - (await prisma.gift.count({ where: { senderId: userId, createdAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) } } }))),
    giftsPerDay: ctx.rules.trading.giftsPerDay,
    offerTtlHours: ctx.rules.trading.offerTtlHours,
  };
}

