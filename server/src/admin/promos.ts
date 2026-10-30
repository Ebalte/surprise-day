/**
 * Ссылки-подарки: админ создаёт ссылку на набор стилей питомца и задаёт, сколько раз её можно получить.
 * Открыть ссылку может и новый, и уже играющий игрок; каждый получает подарок один раз.
 */
import { InlineKeyboard, type Bot } from "grammy";
import { prisma } from "../db.js";
import { PROMO_PACKS, newPromoCode } from "../game/cosmetics.js";
import { esc, show, type AdminBotOptions, type AdminContext, type StepHandlers } from "./bot.js";

export function promoUrl(code: string, opts: Pick<AdminBotOptions, "gameLink" | "webAppUrl">) {
  if (opts.gameLink?.startsWith("https://t.me/")) return `${opts.gameLink}?startapp=promo_${code}`;
  return `${(opts.webAppUrl ?? opts.gameLink ?? "").replace(/\/$/, "")}/?promo=${code}`;
}
const limitText = (p: { uses: number; maxUses: number | null }) => (p.maxUses == null ? `${p.uses} (без ограничения)` : `${p.uses} из ${p.maxUses}`);
const icon = (p: { isActive: boolean; uses: number; maxUses: number | null }) =>
  !p.isActive ? "⏸" : p.maxUses != null && p.uses >= p.maxUses ? "⚪" : "🟢";

function parseLimit(text: string) {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 0 && n <= 1_000_000 ? n : null;
}

async function showList(ctx: AdminContext, note = "") {
  ctx.session.step = undefined;
  const promos = await prisma.promoLink.findMany({ orderBy: { id: "desc" }, take: 20 });
  const kb = new InlineKeyboard();
  for (const p of promos) kb.text(`${icon(p)} ${PROMO_PACKS[p.pack]?.title ?? p.pack} · ${limitText(p)}`, `promo:${p.id}`).row();
  kb.text("➕ Новая ссылка", "promo.new").row().text("◀ Меню", "menu");
  await show(ctx, `${note}<b>Ссылки-подарки</b>\n🟢 работает · ⚪ подарки закончились · ⏸ выключена\n\n${promos.length ? "Нажмите на ссылку, чтобы скопировать её или изменить лимит." : "Пока ни одной. Создайте первую."}`, kb);
}

async function showPromo(ctx: AdminContext, id: number, opts: AdminBotOptions, note = "") {
  ctx.session.step = undefined;
  const p = await prisma.promoLink.findUnique({ where: { id } });
  if (!p) return showList(ctx);
  const pack = PROMO_PACKS[p.pack];
  const text = [
    note,
    `${icon(p)} <b>${esc(pack?.title ?? p.pack)}</b>`,
    `Ссылка: ${esc(promoUrl(p.code, opts))}`,
    `Получили: <b>${limitText(p)}</b>`,
    p.isActive ? "Статус: работает" : "Статус: выключена, подарок не выдаётся",
    "",
    "Наряд для питомца и оформление комнаты. Подарок может получить и новый, и уже играющий игрок, каждый по одному разу.",
  ].filter((x) => x !== "").join("\n");
  const kb = new InlineKeyboard()
    .text("✏️ Изменить лимит", `promo.lim:${p.id}`).row()
    .text(p.isActive ? "⏸ Выключить" : "▶ Включить", `promo.toggle:${p.id}`).row()
    .text("◀ К подаркам", "promo");
  await show(ctx, text, kb);
}

export function registerPromos(bot: Bot<AdminContext>, steps: StepHandlers, opts: AdminBotOptions) {
  bot.callbackQuery("promo", (ctx) => showList(ctx));
  bot.callbackQuery(/^promo:(\d+)$/, (ctx) => showPromo(ctx, Number(ctx.match[1]), opts));

  bot.callbackQuery("promo.new", async (ctx) => {
    const kb = new InlineKeyboard();
    for (const [key, pack] of Object.entries(PROMO_PACKS)) kb.text(pack.title, `promo.pack:${key}`).row();
    kb.text("✖ Отмена", "promo");
    await show(ctx, "<b>Новая ссылка-подарок</b>\nЧто будет в подарке?", kb);
  });
  bot.callbackQuery(/^promo\.pack:(.+)$/, async (ctx) => {
    if (!PROMO_PACKS[ctx.match[1]]) return showList(ctx);
    ctx.session.step = "promo.limit";
    ctx.session.promoPack = ctx.match[1];
    await show(ctx, "Сколько раз можно получить подарок по этой ссылке?\nПришлите число, например <b>100</b>. <b>0</b> — без ограничения.", new InlineKeyboard().text("✖ Отмена", "promo"));
  });
  steps["promo.limit"] = async (ctx) => {
    const n = parseLimit(ctx.message?.text ?? "");
    if (n == null || !ctx.session.promoPack) return void (await ctx.reply("Нужно целое число от 0 до 1 000 000 (0 — без ограничения) или /cancel."));
    const p = await prisma.promoLink.create({ data: { code: newPromoCode(), pack: ctx.session.promoPack, maxUses: n || null, createdBy: BigInt(ctx.from!.id) } });
    ctx.session.promoPack = undefined;
    await showPromo(ctx, p.id, opts, "✅ Ссылка готова. Отправьте её в канал или чат.\n");
  };

  bot.callbackQuery(/^promo\.lim:(\d+)$/, async (ctx) => {
    ctx.session.step = "promo.setlimit";
    ctx.session.promoId = Number(ctx.match[1]);
    await show(ctx, "Новый лимит: сколько раз всего можно получить подарок? <b>0</b> — без ограничения.", new InlineKeyboard().text("✖ Отмена", `promo:${ctx.match[1]}`));
  });
  steps["promo.setlimit"] = async (ctx) => {
    const n = parseLimit(ctx.message?.text ?? "");
    const id = ctx.session.promoId;
    if (n == null || !id) return void (await ctx.reply("Нужно целое число от 0 до 1 000 000 (0 — без ограничения) или /cancel."));
    await prisma.promoLink.update({ where: { id }, data: { maxUses: n || null } });
    ctx.session.promoId = undefined;
    await showPromo(ctx, id, opts, "✅ Лимит изменён.\n");
  };

  bot.callbackQuery(/^promo\.toggle:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const p = await prisma.promoLink.findUnique({ where: { id } });
    if (!p) return showList(ctx);
    await prisma.promoLink.update({ where: { id }, data: { isActive: !p.isActive } });
    await showPromo(ctx, id, opts, p.isActive ? "⏸ Выключена.\n" : "▶ Снова работает.\n");
  });
}
