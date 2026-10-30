/**
 * Пати: общий питомец на двоих (пара ❤️ или друзья 🤝).
 * Хозяин создаёт пати из своей фигурки и зовёт второго ссылкой ?startapp=pair_<код> или кодом.
 * Общий питомец живёт всегда (не стоит на паузе), ухаживать может любой из двоих.
 */
import { randomInt } from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "../db.js";
import { GameError, lockUsers } from "./core.js";
import { DAY_MS, TEAM_GOAL, findPairFor, mskDay, petView, tick } from "./pets.js";
import { displayName } from "./social.js";
import type { refLink } from "./state.js";

type Tx = Prisma.TransactionClient;
export const PAIR_KINDS = ["couple", "friends"] as const;
export type PairKind = (typeof PAIR_KINDS)[number];
type Links = Parameters<typeof refLink>[1];

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // без похожих 0/O, 1/I/L
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
export const normCode = (code: string) => code.trim().toUpperCase().replace(/^PAIR_/, "");

export function inviteLink(code: string, e: Links) {
  if (e.BOT_USERNAME && e.MINI_APP_SHORT_NAME) return `https://t.me/${e.BOT_USERNAME}/${e.MINI_APP_SHORT_NAME}?startapp=pair_${code}`;
  return `${e.WEB_APP_URL.replace(/\/$/, "")}/?pair=${code}`;
}

async function uniqueCode(tx: Tx) {
  for (;;) {
    const code = newCode();
    if (!(await tx.pair.findUnique({ where: { inviteCode: code } }))) return code;
  }
}

export async function createPair(userId: number, figureCode: string, kind: PairKind, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, userId);
    if (await findPairFor(tx, userId)) throw new GameError("in_pair", "Вы уже в пати. Чтобы создать новую, сначала выйдите из этой");
    const owns = await tx.userFigure.findFirst({ where: { userId, count: { gt: 0 }, figure: { code: figureCode } } });
    if (!owns) throw new GameError("not_owned", "Этой фигурки нет в коллекции");
    // Общий питомец начинает с нуля, независимо от личного питомца той же фигурки
    const pet = await tx.pet.create({ data: { userId: null, figureCode, last: now, activeSince: now } });
    return tx.pair.create({ data: { kind, ownerId: userId, inviteCode: await uniqueCode(tx), petId: pet.id, createdAt: now } });
  });
}

/** Что показать по приглашению до того, как игрок согласится */
export async function invitePreview(userId: number, code: string) {
  const pair = await prisma.pair.findUnique({ where: { inviteCode: normCode(code) }, include: { owner: true, pet: true } });
  if (!pair) throw new GameError("no_invite", "Приглашение не найдено. Возможно, его уже обновили", 404);
  return {
    owner: displayName(pair.owner), kind: pair.kind, figureCode: pair.pet.figureCode,
    full: !!pair.partnerId, mine: pair.ownerId === userId,
  };
}

export async function joinPair(userId: number, code: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, userId);
    const [row] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM pairs WHERE "inviteCode" = ${normCode(code)} FOR UPDATE`;
    if (!row) throw new GameError("no_invite", "Приглашение не найдено. Проверьте код", 404);
    const pair = await tx.pair.findUniqueOrThrow({ where: { id: row.id }, include: { pet: true } });
    if (pair.ownerId === userId) throw new GameError("own_invite", "Это ваше приглашение. Отправьте его другу");
    if (pair.partnerId === userId) return { pair, already: true };
    if (pair.partnerId) throw new GameError("pair_full", "В этой пати уже двое", 409);
    if (await findPairFor(tx, userId)) throw new GameError("in_pair", "Вы уже в другой пати. Сначала выйдите из неё", 409);
    const updated = await tx.pair.update({ where: { id: pair.id }, data: { partnerId: userId, joinedAt: now, careStreak: 0 }, include: { pet: true } });
    await tx.petLog.create({ data: { petId: pair.petId, userId, action: "join", createdAt: now } });
    return { pair: updated, already: false };
  });
}

/** Выйти из пати. Если остался второй — питомец остаётся ему, место освобождается под новое приглашение. */
export async function leavePair(userId: number, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, userId);
    const pair = await findPairFor(tx, userId);
    if (!pair) throw new GameError("no_pair", "Вы не в пати");
    await tx.$queryRaw`SELECT id FROM pairs WHERE id = ${pair.id} FOR UPDATE`;
    const other = pair.ownerId === userId ? pair.partnerId : pair.ownerId;
    if (!other) {
      await tx.pet.delete({ where: { id: pair.petId } }); // пати удаляется каскадом
      return { remaining: null };
    }
    await tx.pair.update({ where: { id: pair.id }, data: { ownerId: other, partnerId: null, joinedAt: null, careStreak: 0, inviteCode: await uniqueCode(tx) } });
    await tx.petLog.create({ data: { petId: pair.petId, userId, action: "leave", createdAt: now } });
    return { remaining: other };
  });
}

const LOG_TEXT: Record<string, string> = {
  feed: "покормил(а)", toy: "поиграл(а) с мячиком", wash: "помыл(а)", sleep: "уложил(а) спать", wake: "разбудил(а)",
  game: "сыграл(а) в мини-игру", join: "присоединился(ась) к пати", leave: "вышел(ла) из пати",
};

/** Всё про пати игрока для /api/state (или null) */
export async function pairView(user: User, links: Links, now = new Date()) {
  const pair = await prisma.pair.findFirst({
    where: { OR: [{ ownerId: user.id }, { partnerId: user.id }] },
    include: { owner: true, partner: true, pet: true },
  });
  if (!pair) return null;
  const isOwner = pair.ownerId === user.id;
  const mate = isOwner ? pair.partner : pair.owner;
  const p = pair.pet; tick(p, now);
  const [log, days] = await Promise.all([
    prisma.petLog.findMany({ where: { petId: p.id }, orderBy: { createdAt: "desc" }, take: 8, include: { user: true } }),
    prisma.pairDay.findMany({ where: { pairId: pair.id, day: { in: [mskDay(now), mskDay(new Date(now.getTime() - DAY_MS))] } } }),
  ]);
  const today = days.find((d) => d.day === mskDay(now));
  const yesterday = days.find((d) => d.day !== mskDay(now));
  const both = (d?: typeof today) => !!d && d.ownerCared && d.partnerCared;
  // Серия «живая»: если вчера и сегодня никто вдвоём не заботился — она уже сгорела
  const careStreak = both(today) || both(yesterday) ? pair.careStreak : 0;
  return {
    id: pair.id, kind: pair.kind as PairKind, role: isOwner ? "owner" : "partner",
    partner: mate ? { name: displayName(mate), photoUrl: mate.photoUrl } : null,
    inviteCode: mate ? null : pair.inviteCode,
    inviteLink: mate ? null : inviteLink(pair.inviteCode, links),
    pet: petView(p, now),
    log: log.map((l) => ({ name: l.userId === user.id ? "Вы" : displayName(l.user), action: LOG_TEXT[l.action] ?? l.action, at: l.createdAt.toISOString() })),
    today: {
      meCared: !!today && (isOwner ? today.ownerCared : today.partnerCared),
      mateCared: !!today && (isOwner ? today.partnerCared : today.ownerCared),
      myPoints: today ? (isOwner ? today.ownerPoints : today.partnerPoints) : 0,
      matePoints: today ? (isOwner ? today.partnerPoints : today.ownerPoints) : 0,
      goal: TEAM_GOAL, rewarded: !!today?.teamRewarded,
    },
    careStreak,
  };
}

/** Приглашение в пати от нового игрока засчитываем и как приглашение друга */
export async function pairInviterRef(code: string) {
  const pair = await prisma.pair.findUnique({ where: { inviteCode: normCode(code) } });
  return pair ? `ref_${pair.ownerId}` : undefined;
}
