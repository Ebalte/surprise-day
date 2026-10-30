/**
 * Картинки для сторис. Telegram публикует сторис только по публичной https-ссылке, поэтому
 * игра присылает сюда готовую карточку (JPEG), а сервер раздаёт её по случайному id.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { GameError } from "./core.js";

const MAX_BYTES = 1_500_000, PER_DAY = 30, KEEP_MS = 3 * 86400_000;

export async function saveStory(userId: number, dataUrl: string, now = new Date()) {
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
  return { id, url: `/api/stories/${id}.jpg` };
}

export async function loadStory(id: string) {
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  return prisma.storyImage.findUnique({ where: { id } });
}
