/**
 * События сезона (временные фигурки): запустить сейчас, остановить, вернуть даты из конфига.
 * Даты хранятся в настройке events.schedule и перекрывают startsAt/endsAt из seasons/*.json.
 */
import { InlineKeyboard, type Bot } from "grammy";
import { prisma } from "../db.js";
import { getActiveRules, getActiveSeason } from "../seasons/active.js";
import { getOverrides, resetSetting, setSetting } from "../settings/service.js";
import { esc, show, type AdminContext } from "./bot.js";

type Schedule = Record<string, { startsAt: string; endsAt: string }>;
const DAY = 86400_000;
const fmt = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function status(e: { startsAt: string; endsAt: string }, now = new Date()) {
  const s = new Date(e.startsAt), f = new Date(e.endsAt);
  if (now < s) return { icon: "⏳", text: `начнётся ${fmt(s)}`, active: false };
  if (now < f) return { icon: "🟢", text: `идёт до ${fmt(f)}`, active: true };
  return { icon: "⚪", text: `закончилось ${fmt(f)}`, active: false };
}

async function schedule(): Promise<Schedule> {
  return ((await getOverrides()).get("events.schedule") as Schedule | undefined) ?? {};
}

async function saveSchedule(next: Schedule, adminId: number) {
  if (Object.keys(next).length) await setSetting("events.schedule", next, adminId);
  else await resetSetting("events.schedule", adminId);
}

async function showList(ctx: AdminContext) {
  const rules = await getActiveRules();
  const events = rules.events ?? [];
  const kb = new InlineKeyboard();
  for (const e of events) kb.text(`${status(e).icon} ${e.title}`, `ev:${e.slug}`).row();
  kb.text("◀ Меню", "menu");
  const text = events.length
    ? `<b>События</b>\n🟢 идёт · ⏳ скоро · ⚪ закончилось\n\n${events.map((e) => `${status(e).icon} <b>${esc(e.title)}</b> — ${status(e).text}`).join("\n")}\n\nВремя московское.`
    : "<b>События</b>\nВ конфиге сезона нет событий. Их добавляют блоком events в seasons/season1.json.";
  await show(ctx, text, kb);
}

async function showEvent(ctx: AdminContext, slug: string, note = "") {
  const [rules, season, sched] = await Promise.all([getActiveRules(), getActiveSeason(), schedule()]);
  const e = rules.events?.find((x) => x.slug === slug);
  if (!e) return showList(ctx);
  const st = status(e);
  const collected = await prisma.userBadge.count({ where: { code: e.badge.code } });
  const figures = await prisma.figure.findMany({ where: { seasonId: season.id, eventSlug: slug }, select: { name: true } });
  const text = [
    note,
    `${st.icon} <b>${esc(e.title)}</b>`,
    `Статус: ${st.text}`,
    `Даты: ${fmt(new Date(e.startsAt))} — ${fmt(new Date(e.endsAt))} (МСК)${sched[slug] ? " ✏️ изменены здесь" : " · из конфига"}`,
    `Шанс фигурки события в яйце: ${Math.round(e.dropChance * 100)}%`,
    `Фигурки: ${figures.map((f) => esc(f.name)).join(", ") || "—"}`,
    `Собрали все и получили бейдж «${esc(e.badge.title)}»: ${collected}`,
  ].filter(Boolean).join("\n");
  const kb = new InlineKeyboard();
  kb.text(st.active ? "Продлить: ещё…" : "▶ Запустить сейчас на:", "noop").row();
  for (const d of [1, 3, 7, 14]) kb.text(`${d} ${d === 1 ? "день" : d < 5 ? "дня" : "дней"}`, `ev.start:${slug}:${d}`);
  kb.row();
  if (st.active) kb.text("⏹ Остановить сейчас", `ev.stop:${slug}`).row();
  else if (st.icon === "⏳") kb.text("⏹ Отменить (не запускать)", `ev.stop:${slug}`).row();
  if (sched[slug]) kb.text("📅 Вернуть даты из конфига", `ev.reset:${slug}`).row();
  kb.text("◀ К событиям", "ev");
  await show(ctx, text, kb);
}

export function registerEvents(bot: Bot<AdminContext>) {
  bot.callbackQuery("ev", showList);
  bot.callbackQuery("noop", () => {});
  bot.callbackQuery(/^ev:(.+)$/, (ctx) => showEvent(ctx, ctx.match[1]));

  bot.callbackQuery(/^ev\.start:(.+):(\d+)$/, async (ctx) => {
    const [slug, days] = [ctx.match[1], Number(ctx.match[2])];
    const rules = await getActiveRules();
    const e = rules.events?.find((x) => x.slug === slug);
    if (!e) return showList(ctx);
    const now = Date.now();
    // Идёт — продлеваем от текущего конца, иначе — запускаем с этой минуты
    const running = status(e).active;
    const startsAt = running ? e.startsAt : new Date(now).toISOString();
    const endsAt = new Date((running ? new Date(e.endsAt).getTime() : now) + days * DAY).toISOString();
    await saveSchedule({ ...(await schedule()), [slug]: { startsAt, endsAt } }, ctx.from.id);
    await ctx.answerCallbackQuery(running ? "Событие продлено" : "Событие запущено");
    await showEvent(ctx, slug, running
      ? `✅ Продлено до ${fmt(new Date(endsAt))}.\n`
      : `✅ Запущено до ${fmt(new Date(endsAt))}. Игроки увидят баннер в течение 10 секунд. Сообщить им можно через 📨 Рассылку.\n`);
  });

  bot.callbackQuery(/^ev\.stop:(.+)$/, async (ctx) => {
    const slug = ctx.match[1];
    const rules = await getActiveRules();
    const e = rules.events?.find((x) => x.slug === slug);
    if (!e) return showList(ctx);
    const now = new Date();
    const startsAt = new Date(e.startsAt) < now ? e.startsAt : new Date(now.getTime() - 1000).toISOString();
    await saveSchedule({ ...(await schedule()), [slug]: { startsAt, endsAt: now.toISOString() } }, ctx.from.id);
    await ctx.answerCallbackQuery("Событие остановлено");
    await showEvent(ctx, slug, "⏹ Остановлено. Фигурки события больше не выпадают, собранные остаются у игроков.\n");
  });

  bot.callbackQuery(/^ev\.reset:(.+)$/, async (ctx) => {
    const slug = ctx.match[1];
    const { [slug]: _removed, ...rest } = await schedule();
    await saveSchedule(rest, ctx.from.id);
    await showEvent(ctx, slug, "📅 Даты снова как в конфиге сезона.\n");
  });
}
