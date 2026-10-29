import { InlineKeyboard, type Bot } from "grammy";
import type { AdCampaign } from "@prisma/client";
import { prisma } from "../db.js";
import { esc, show, type AdminContext, type AdDraft, type StepHandlers } from "./bot.js";

const PLACEMENT = { REWARDED: "за яйцо", BANNER: "баннер на главном" } as const;
const isSkip = (t?: string) => !t || /^\/?(skip|пропустить|нет|-)$/i.test(t.trim());
const fmtDate = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "UTC" });

function adStatus(ad: AdCampaign, now = new Date()) {
  if (!ad.isActive) return "⏸";
  if (ad.endsAt && ad.endsAt <= now) return "⌛";
  if (ad.maxImpressions != null && ad.impressions >= ad.maxImpressions) return "⌛";
  return "🟢";
}

function adCard(ad: AdCampaign) {
  const ctr = ad.impressions ? ((ad.clicks / ad.impressions) * 100).toFixed(1) : "0";
  const lines = [
    `${adStatus(ad)} <b>${esc(ad.title)}</b> · #${ad.id}`,
    `Где: ${PLACEMENT[ad.placement]}${ad.placement === "REWARDED" ? `, ${ad.durationSec} сек` : ""}`,
    `Срок: ${ad.endsAt ? `до ${fmtDate(ad.endsAt)}` : "бессрочно"}`,
    `Кнопка: ${ad.url ? `${esc(ad.buttonText ?? "Подробнее")} → ${esc(ad.url)}` : "нет"}`,
    "",
    `Показы: <b>${ad.impressions}</b>${ad.placement === "REWARDED" ? ` · досмотрели: <b>${ad.completions}</b>` : ""}`,
    `Клики: <b>${ad.clicks}</b> · CTR ${ctr}%`,
    "",
    `Текст:\n${esc(ad.text)}`,
  ];
  const kb = new InlineKeyboard()
    .text(ad.isActive ? "⏸ Пауза" : "▶ Запустить", `ad.toggle:${ad.id}`)
    .text("👁 Как увидят игроки", `ad.preview:${ad.id}`).row()
    .text("🗑 Удалить", `ad.del:${ad.id}`).text("◀ К списку", "ads");
  return { text: lines.join("\n"), kb };
}

/** Отправить рекламу так, как её увидят игроки */
async function sendPreview(ctx: AdminContext, ad: Pick<AdDraft, "text" | "mediaFileId" | "mediaType" | "url" | "buttonText">) {
  const kb = ad.url ? new InlineKeyboard().url(ad.buttonText || "Подробнее", ad.url) : undefined;
  const text = ad.text ?? "";
  if (ad.mediaFileId && ad.mediaType === "photo") await ctx.replyWithPhoto(ad.mediaFileId, { caption: text, reply_markup: kb });
  else if (ad.mediaFileId && ad.mediaType === "video") await ctx.replyWithVideo(ad.mediaFileId, { caption: text, reply_markup: kb });
  else await ctx.reply(text, { reply_markup: kb });
}

function parseUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function parseDate(input: string): Date | null {
  const m = input.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59));
  return d.getUTCDate() === Number(m[1]) ? d : null;
}

async function askNext(ctx: AdminContext) {
  const d = ctx.session.ad!;
  if (!d.placement) {
    ctx.session.step = undefined;
    const kb = new InlineKeyboard().text("🥚 За яйцо (с таймером)", "adp:REWARDED").row().text("🖼 Баннер на главном", "adp:BANNER").row().text("✖ Отмена", "ads");
    return show(ctx, "<b>Новая реклама</b> · шаг 1\nГде показывать?\n\n• <b>За яйцо</b>: игрок смотрит рекламу несколько секунд и получает бонусное яйцо.\n• <b>Баннер</b>: карточка на главном экране игры.", kb);
  }
  const ask = (step: string, text: string) => {
    ctx.session.step = step;
    return ctx.reply(text + "\n\n/cancel — отменить", { parse_mode: "HTML" });
  };
  if (!d.title) return ask("ad.title", "<b>Шаг 2.</b> Как назвать кампанию? Название видно только администраторам.");
  if (!d.text) return ask("ad.content", "<b>Шаг 3.</b> Пришлите картинку или видео с подписью: подпись станет текстом рекламы. Можно прислать просто текст.");
  if (d.url === undefined) return ask("ad.url", "<b>Шаг 4.</b> Ссылка для кнопки (https://…). Если кнопка не нужна — /skip");
  if (d.url && d.buttonText === undefined) return ask("ad.button", "<b>Шаг 5.</b> Текст кнопки. /skip — будет «Подробнее».");
  if (d.placement === "REWARDED" && !d.durationSec) return ask("ad.duration", "<b>Шаг 6.</b> Сколько секунд смотреть рекламу, чтобы получить яйцо? Число от 3 до 30.");
  if (d.endsAt === undefined) return ask("ad.until", "<b>Последний шаг.</b> До какой даты показывать? Формат ДД.ММ.ГГГГ, например 31.12.2026. /skip — бессрочно.");

  ctx.session.step = undefined;
  await ctx.reply("Так реклама будет выглядеть у игроков:");
  await sendPreview(ctx, d);
  const kb = new InlineKeyboard().text("✅ Запустить сейчас", "ad.save:1").row().text("💾 Сохранить на паузе", "ad.save:0").row().text("✖ Отмена", "ads");
  await ctx.reply(
    [
      `<b>${esc(d.title)}</b>`,
      `Где: ${PLACEMENT[d.placement]}${d.durationSec ? `, ${d.durationSec} сек` : ""}`,
      `Срок: ${d.endsAt ? `до ${fmtDate(new Date(d.endsAt))}` : "бессрочно"}`,
    ].join("\n"),
    { parse_mode: "HTML", reply_markup: kb },
  );
}

async function showList(ctx: AdminContext) {
  ctx.session.step = undefined;
  const ads = await prisma.adCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  const kb = new InlineKeyboard();
  ads.forEach((ad) => kb.text(`${adStatus(ad)} ${ad.title} · ${ad.impressions} показов`.slice(0, 60), `ad:${ad.id}`).row());
  kb.text("➕ Новая реклама", "ad.new").row().text("◀ Меню", "menu");
  const text = ads.length
    ? `<b>Реклама</b>\n🟢 идёт · ⏸ на паузе · ⌛ закончилась\n\nАктивных: ${ads.filter((a) => adStatus(a) === "🟢").length} из ${ads.length}`
    : "<b>Реклама</b>\nКампаний пока нет. Пока их нет, кнопка «Реклама: +1 яйцо» в игре скрыта.";
  await show(ctx, text, kb);
}

async function showAd(ctx: AdminContext, id: number) {
  const ad = await prisma.adCampaign.findUnique({ where: { id } });
  if (!ad) return showList(ctx);
  const { text, kb } = adCard(ad);
  await show(ctx, text, kb);
}

export function registerAds(bot: Bot<AdminContext>, steps: StepHandlers) {
  bot.callbackQuery("ads", showList);
  bot.callbackQuery(/^ad:(\d+)$/, (ctx) => showAd(ctx, Number(ctx.match[1])));

  bot.callbackQuery("ad.new", async (ctx) => {
    ctx.session.ad = {};
    await askNext(ctx);
  });
  bot.callbackQuery(/^adp:(REWARDED|BANNER)$/, async (ctx) => {
    ctx.session.ad = { ...ctx.session.ad, placement: ctx.match[1] as AdDraft["placement"] };
    await askNext(ctx);
  });

  steps["ad.title"] = async (ctx) => {
    const t = ctx.message?.text?.trim();
    if (!t) return void (await ctx.reply("Пришлите название текстом."));
    ctx.session.ad!.title = t.slice(0, 60);
    await askNext(ctx);
  };
  steps["ad.content"] = async (ctx) => {
    const m = ctx.message!;
    const d = ctx.session.ad!;
    const text = (m.caption ?? m.text ?? "").trim();
    if (m.photo) Object.assign(d, { mediaFileId: m.photo[m.photo.length - 1].file_id, mediaType: "photo" });
    else if (m.video) Object.assign(d, { mediaFileId: m.video.file_id, mediaType: "video" });
    else if (!m.text) return void (await ctx.reply("Нужна картинка, видео или текст."));
    if (!text) return void (await ctx.reply("Добавьте подпись к картинке: это текст рекламы. Пришлите ещё раз с подписью."));
    if (text.length > 500) return void (await ctx.reply(`Текст длинноват: ${text.length} символов. Сократите до 500.`));
    d.text = text;
    await askNext(ctx);
  };
  steps["ad.url"] = async (ctx) => {
    const t = ctx.message?.text;
    if (isSkip(t)) ctx.session.ad!.url = "";
    else {
      const url = parseUrl(t!);
      if (!url) return void (await ctx.reply("Это не похоже на ссылку. Пример: https://example.com. Или /skip"));
      ctx.session.ad!.url = url;
    }
    await askNext(ctx);
  };
  steps["ad.button"] = async (ctx) => {
    const t = ctx.message?.text;
    ctx.session.ad!.buttonText = isSkip(t) ? "Подробнее" : t!.trim().slice(0, 30);
    await askNext(ctx);
  };
  steps["ad.duration"] = async (ctx) => {
    const n = Number(ctx.message?.text?.trim());
    if (!Number.isInteger(n) || n < 3 || n > 30) return void (await ctx.reply("Нужно целое число от 3 до 30."));
    ctx.session.ad!.durationSec = n;
    await askNext(ctx);
  };
  steps["ad.until"] = async (ctx) => {
    const t = ctx.message?.text;
    if (isSkip(t)) ctx.session.ad!.endsAt = "";
    else {
      const d = parseDate(t!);
      if (!d) return void (await ctx.reply("Не понял дату. Формат ДД.ММ.ГГГГ, например 31.12.2026. Или /skip"));
      if (d <= new Date()) return void (await ctx.reply("Эта дата уже прошла. Укажите будущую."));
      ctx.session.ad!.endsAt = d.toISOString();
    }
    await askNext(ctx);
  };

  bot.callbackQuery(/^ad\.save:([01])$/, async (ctx) => {
    const d = ctx.session.ad;
    if (!d?.placement || !d.title || !d.text) return showList(ctx);
    const ad = await prisma.adCampaign.create({
      data: {
        title: d.title,
        placement: d.placement,
        text: d.text,
        mediaFileId: d.mediaFileId,
        mediaType: d.mediaType,
        url: d.url || null,
        buttonText: d.url ? d.buttonText || "Подробнее" : null,
        durationSec: d.durationSec ?? 5,
        endsAt: d.endsAt ? new Date(d.endsAt) : null,
        isActive: ctx.match[1] === "1",
        createdBy: BigInt(ctx.from.id),
      },
    });
    await prisma.adminLog.create({ data: { adminId: BigInt(ctx.from.id), action: "ad.create", payload: { id: ad.id, active: ad.isActive } } });
    ctx.session.ad = undefined;
    await ctx.answerCallbackQuery(ad.isActive ? "Реклама запущена" : "Сохранено на паузе");
    await showAd(ctx, ad.id);
  });

  bot.callbackQuery(/^ad\.toggle:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const ad = await prisma.adCampaign.findUnique({ where: { id } });
    if (!ad) return showList(ctx);
    await prisma.adCampaign.update({ where: { id }, data: { isActive: !ad.isActive } });
    await prisma.adminLog.create({ data: { adminId: BigInt(ctx.from.id), action: ad.isActive ? "ad.pause" : "ad.start", payload: { id } } });
    await ctx.answerCallbackQuery(ad.isActive ? "На паузе" : "Запущена");
    await showAd(ctx, id);
  });

  bot.callbackQuery(/^ad\.preview:(\d+)$/, async (ctx) => {
    const ad = await prisma.adCampaign.findUnique({ where: { id: Number(ctx.match[1]) } });
    if (ad) await sendPreview(ctx, { ...ad, mediaFileId: ad.mediaFileId ?? undefined, mediaType: (ad.mediaType ?? undefined) as AdDraft["mediaType"], url: ad.url ?? undefined, buttonText: ad.buttonText ?? undefined });
  });

  bot.callbackQuery(/^ad\.del:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const kb = new InlineKeyboard().text("🗑 Да, удалить", `ad.delok:${id}`).text("Отмена", `ad:${id}`);
    await show(ctx, `Удалить рекламу #${id}? Статистика показов тоже удалится.`, kb);
  });
  bot.callbackQuery(/^ad\.delok:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    await prisma.adCampaign.deleteMany({ where: { id } });
    await prisma.adminLog.create({ data: { adminId: BigInt(ctx.from.id), action: "ad.delete", payload: { id } } });
    await ctx.answerCallbackQuery("Удалено");
    await showList(ctx);
  });
}
