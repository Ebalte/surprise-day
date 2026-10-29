import { InlineKeyboard, type Bot } from "grammy";
import { getActiveSeason } from "../seasons/active.js";
import {
  SETTINGS, SettingError, currentValue, resetSetting, setSetting, settingByKey, type SettingDef,
} from "../settings/service.js";
import { esc, show, type AdminContext, type StepHandlers } from "./bot.js";

async function showSettings(ctx: AdminContext, note = "") {
  ctx.session.step = undefined;
  const { rules } = await getActiveSeason();
  const lines: string[] = [];
  const kb = new InlineKeyboard();
  for (const [i, def] of SETTINGS.entries()) {
    const { value, overridden } = await currentValue(def, rules);
    lines.push(`• ${def.title}: <b>${esc(def.format(value))}</b>${overridden ? " ✏️" : ""}`);
    const label = def.kind === "bool" ? `${value ? "🟢" : "⚪"} ${def.title}` : def.title;
    kb.text(label, `set:${def.key}`);
    if (i % 2 === 1) kb.row();
  }
  kb.row().text("◀ Меню", "menu");
  await show(
    ctx,
    `${note ? note + "\n\n" : ""}<b>Настройки игры</b>\n${lines.join("\n")}\n\n✏️ — изменено здесь, остальное взято из seasons/*.json. Игроки увидят изменения в течение 10 секунд.`,
    kb,
  );
}

async function askValue(ctx: AdminContext, def: SettingDef) {
  const { rules } = await getActiveSeason();
  const { value, overridden } = await currentValue(def, rules);
  ctx.session.step = "setting.value";
  ctx.session.settingKey = def.key;
  const kb = new InlineKeyboard();
  if (overridden) kb.text("↩ Вернуть из конфига", `setreset:${def.key}`).row();
  kb.text("✖ Отмена", "settings");
  await show(ctx, `<b>${def.title}</b>\nСейчас: <b>${esc(def.format(value))}</b>\n\n${esc(def.hint)}\n\nПришлите новое значение.`, kb);
}

export function registerSettings(bot: Bot<AdminContext>, steps: StepHandlers) {
  bot.callbackQuery("settings", (ctx) => showSettings(ctx));

  bot.callbackQuery(/^set:(.+)$/, async (ctx) => {
    const def = settingByKey(ctx.match[1]);
    if (!def) return showSettings(ctx);
    if (def.kind === "value") return askValue(ctx, def);
    const { rules } = await getActiveSeason();
    const { value } = await currentValue(def, rules);
    // Закрыть игру — только с подтверждением
    if (def.key === "maintenance" && !value) {
      const kb = new InlineKeyboard().text("Да, закрыть игру", "setbool:maintenance:1").text("Отмена", "settings");
      return show(ctx, "Включить техработы? Игроки увидят «Скоро вернёмся» и не смогут открывать яйца.", kb);
    }
    await setSetting(def.key, !value, ctx.from.id);
    await showSettings(ctx, `✅ ${def.title}: ${def.format(!value)}`);
  });

  bot.callbackQuery(/^setbool:(.+):([01])$/, async (ctx) => {
    const def = settingByKey(ctx.match[1]);
    if (!def) return showSettings(ctx);
    const v = ctx.match[2] === "1";
    await setSetting(def.key, v, ctx.from.id);
    await showSettings(ctx, `✅ ${def.title}: ${def.format(v)}`);
  });

  bot.callbackQuery(/^setreset:(.+)$/, async (ctx) => {
    const def = settingByKey(ctx.match[1]);
    if (!def) return showSettings(ctx);
    await resetSetting(def.key, ctx.from.id);
    await showSettings(ctx, `↩ ${def.title}: снова как в конфиге`);
  });

  steps["setting.value"] = async (ctx) => {
    const def = settingByKey(ctx.session.settingKey ?? "");
    const text = ctx.message?.text;
    if (!def || !text) return void (await ctx.reply("Пришлите значение текстом или /cancel."));
    try {
      const value = def.parse(text);
      await setSetting(def.key, value, ctx.from!.id);
      ctx.session.settingKey = undefined;
      await showSettings(ctx, `✅ ${def.title}: <b>${esc(def.format(value))}</b>`);
    } catch (e) {
      if (!(e instanceof SettingError)) throw e;
      await ctx.reply(`${e.message}.\n${def.hint}`);
    }
  };
}
