/**
 * Картинки для сторис. Telegram публикует сторис только по публичной https-ссылке, поэтому
 * игра присылает сюда готовую карточку (JPEG), а сервер раздаёт её по случайному id.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { GameError, addGrants, lockUsers } from "./core.js";
import { mskDayStart } from "./pets.js";

const MAX_BYTES = 1_500_000, PER_DAY = 30, KEEP_MS = 3 * 86400_000;
/** Сколько яиц в день можно получить за сторис с рекордом */
export const STORY_EGGS_PER_DAY = 1;

export async function saveStory(userId: number, dataUrl: string, runId?: number, now = new Date()) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new GameError("bad_image", "Картинка не получилась. Попробуйте ещё раз");
  const data = Buffer.from(m[1], "base64");
  // JPEG начинается с FF D8 FF
  if (data.length > MAX_BYTES || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) throw new GameError("bad_image", "Картинка не получилась. Попробуйте ещё раз");
  const today = await prisma.storyImage.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - 86400_000) } } });
  if (today >= PER_DAY) throw new GameError("story_limit", "На сегодня хватит сторис. Попробуйте завтра", 429);
  await prisma.storyImage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - KEEP_MS) } } });
  const id = randomBytes(12).toString("hex");
  await prisma.storyImage.create({ data: { id, userId, data, createdAt: now } });
  const egg = runId ? await storyEgg(userId, runId, now) : false;
  return { id, url: `/api/stories/${id}.jpg`, egg };
}

/**
 * Яйцо за сторис с рекордом: игра должна быть своим недавним рекордом, одна награда за игру
 * и не больше STORY_EGGS_PER_DAY в сутки (по Москве). Telegram не сообщает, опубликована ли сторис,
 * поэтому награда выдаётся при нажатии «Опубликовать», а дневной лимит не даёт ею злоупотреблять.
 */
async function storyEgg(userId: number, runId: number, now: Date) {
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, userId);
    const run = await tx.gameRun.findFirst({ where: { id: runId, userId, record: true, score: { gt: 0 }, finishedAt: { gte: new Date(now.getTime() - 86400_000) } } });
    if (!run) return false;
    const today = await tx.eggGrant.count({ where: { userId, source: "STORY", createdAt: { gte: mskDayStart(now) } } });
    if (today >= STORY_EGGS_PER_DAY) return false;
    return (await addGrants(tx, userId, [{ source: "STORY", dedupeKey: `story:${run.id}` }])) > 0;
  });
}

export async function loadStory(id: string) {
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  return prisma.storyImage.findUnique({ where: { id } });
}
