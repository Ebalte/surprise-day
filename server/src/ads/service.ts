/**
 * Реклама в игре: выбор кампании, показ за яйцо, клики.
 * Кампании создаются в админ-боте. Яйцо выдаётся только на сервере и только если
 * с начала показа прошло durationSec — клиент не может «досмотреть» рекламу мгновенно.
 */
import type { AdCampaign, AdPlacement } from "@prisma/client";
import { Api } from "grammy";
import { prisma, startOfUtcDay, utcDayKey } from "../db.js";
import { getFlag } from "../settings/service.js";
import { getActiveRules } from "../seasons/active.js";

export class AdError extends Error {
  constructor(public code: "disabled" | "limit" | "no_ad" | "not_found" | "too_early" | "done", message: string) {
    super(message);
  }
}

/** То, что видит сайт */
export function publicAd(ad: AdCampaign) {
  return {
    id: ad.id,
    placement: ad.placement,
    text: ad.text,
    buttonText: ad.url ? ad.buttonText ?? "Подробнее" : null,
    url: ad.url,
    durationSec: ad.durationSec,
    mediaType: ad.mediaType,
    mediaUrl: ad.mediaFileId ? `/api/ads/${ad.id}/media` : null,
  };
}

export async function pickAd(placement: AdPlacement, now = new Date()): Promise<AdCampaign | null> {
  if (!(await getFlag("ads.enabled"))) return null;
  const candidates = (
    await prisma.adCampaign.findMany({
      where: {
        placement,
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
    })
  ).filter((ad) => ad.maxImpressions == null || ad.impressions < ad.maxImpressions);
  if (!candidates.length) return null;
  const total = candidates.reduce((s, ad) => s + Math.max(1, ad.weight), 0);
  let r = Math.random() * total;
  for (const ad of candidates) {
    r -= Math.max(1, ad.weight);
    if (r < 0) return ad;
  }
  return candidates[candidates.length - 1];
}

async function adEggsToday(userId: number, now: Date) {
  return prisma.eggGrant.count({ where: { userId, source: "AD", createdAt: { gte: startOfUtcDay(now) } } });
}

/** Игрок нажал «Реклама: +1 яйцо» */
export async function startAdView(userId: number, now = new Date()) {
  const rules = await getActiveRules();
  if (!(await getFlag("ads.enabled"))) throw new AdError("disabled", "Реклама сейчас выключена");
  if ((await adEggsToday(userId, now)) >= rules.shop.adEggsPerDay) {
    throw new AdError("limit", "Яйцо за рекламу на сегодня уже получено");
  }
  const ad = await pickAd("REWARDED", now);
  if (!ad) throw new AdError("no_ad", "Сейчас нет рекламы для показа");
  const [view] = await prisma.$transaction([
    prisma.adView.create({ data: { campaignId: ad.id, userId, startedAt: now } }),
    prisma.adCampaign.update({ where: { id: ad.id }, data: { impressions: { increment: 1 } } }),
  ]);
  return { viewId: view.id, ad: publicAd(ad) };
}

/** Реклама досмотрена — выдаём яйцо */
export async function completeAdView(userId: number, viewId: number, now = new Date()) {
  const rules = await getActiveRules();
  return prisma.$transaction(async (tx) => {
    const view = await tx.adView.findFirst({ where: { id: viewId, userId }, include: { campaign: true } });
    if (!view) throw new AdError("not_found", "Показ не найден");
    if (view.completedAt) throw new AdError("done", "За этот показ яйцо уже выдано");
    // 500 мс запаса на задержку сети
    if (now.getTime() - view.startedAt.getTime() < view.campaign.durationSec * 1000 - 500) {
      throw new AdError("too_early", "Досмотрите рекламу до конца");
    }
    const used = await tx.eggGrant.count({ where: { userId, source: "AD", createdAt: { gte: startOfUtcDay(now) } } });
    if (used >= rules.shop.adEggsPerDay) throw new AdError("limit", "Яйцо за рекламу на сегодня уже получено");
    await tx.adView.update({ where: { id: view.id }, data: { completedAt: now } });
    await tx.adCampaign.update({ where: { id: view.campaignId }, data: { completions: { increment: 1 } } });
    // dedupeKey уникален для игрока: два одновременных запроса не дадут два яйца
    return tx.eggGrant.create({ data: { userId, source: "AD", dedupeKey: `ad:${utcDayKey(now)}:${used + 1}` } });
  });
}

/** Клик по кнопке в рекламе (и в показе за яйцо, и в баннере) */
export async function registerAdClick(userId: number, campaignId: number, viewId?: number) {
  await prisma.adCampaign.update({ where: { id: campaignId }, data: { clicks: { increment: 1 } } });
  if (viewId) await prisma.adView.updateMany({ where: { id: viewId, userId, clickedAt: null }, data: { clickedAt: new Date() } });
}

// Ссылка на файл в Telegram живёт около часа — кэшируем путь на 50 минут
const filePaths = new Map<string, { path: string; until: number }>();

/**
 * Скачивает картинку/видео кампании из Telegram для прокси /api/ads/:id/media.
 * file_id принадлежит админ-боту, поэтому нужен ADMIN_BOT_TOKEN. Лимит Bot API на скачивание — 20 МБ.
 */
export async function fetchAdMedia(ad: AdCampaign, adminBotToken: string): Promise<Response> {
  if (!ad.mediaFileId) throw new AdError("not_found", "У рекламы нет картинки");
  let cached = filePaths.get(ad.mediaFileId);
  if (!cached || cached.until < Date.now()) {
    const file = await new Api(adminBotToken).getFile(ad.mediaFileId);
    if (!file.file_path) throw new AdError("not_found", "Файл недоступен в Telegram");
    cached = { path: file.file_path, until: Date.now() + 50 * 60_000 };
    filePaths.set(ad.mediaFileId, cached);
  }
  return fetch(`https://api.telegram.org/file/bot${adminBotToken}/${cached.path}`);
}
