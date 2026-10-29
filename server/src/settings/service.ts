/**
 * Настройки, которые администратор меняет в админ-боте.
 * Значение из таблицы settings перекрывает значение из seasons/*.json.
 * Удалили строку — снова действует значение из файла.
 */
import { prisma } from "../db.js";
import type { StoredRules } from "../seasons/active.js";

export class SettingError extends Error {}

type CraftCosts = { common: number; rare: number; epic: number };

export type SettingDef = {
  key: string;
  title: string;
  /** Подсказка, в каком виде вводить значение */
  hint: string;
  kind: "value" | "bool";
  /** Значение из конфига сезона (или по умолчанию для флагов) */
  fromConfig(rules: StoredRules): unknown;
  parse(input: string): unknown;
  format(value: unknown): string;
  /** Как применить значение к правилам сезона. У флагов нет. */
  apply?(rules: StoredRules, value: unknown): void;
};

const int = (min: number, max: number) => (input: string) => {
  const n = Number(input.trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new SettingError(`Нужно целое число от ${min} до ${max}`);
  return n;
};

const intList = (min: number, max: number, minLen: number, maxLen: number) => (input: string) => {
  const parts = input.trim().split(/[\s,;→>-]+/).filter(Boolean);
  const nums = parts.map(Number);
  if (nums.length < minLen || nums.length > maxLen || nums.some((n) => !Number.isInteger(n) || n < min || n > max)) {
    const count = minLen === maxLen ? `${minLen}` : `от ${minLen} до ${maxLen}`;
    throw new SettingError(`Нужно чисел: ${count}, каждое от ${min} до ${max}, через пробел`);
  }
  return nums;
};

const bool = (input: string) => /^(1|да|вкл|on|true|yes)$/i.test(input.trim());

const hours = (input: string) => {
  const n = Number(input.trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0.25 || n > 168) throw new SettingError("Нужно число часов от 0.25 (15 минут) до 168 (неделя)");
  return Math.round(n * 100) / 100;
};
const fmtHours = (v: unknown) => {
  const h = v as number;
  if (h < 1) return `${Math.round(h * 60)} мин`;
  return Number.isInteger(h) ? `${h} ч` : `${Math.floor(h)} ч ${Math.round((h % 1) * 60)} мин`;
};

export const SETTINGS: SettingDef[] = [
  {
    key: "eggIntervalHours",
    title: "Время между яйцами",
    hint: "Сколько часов ждать следующее бесплатное яйцо. Например: 24 — раз в сутки, 12, 6, 0.5 — каждые 30 минут. Серия дней считается по этому же интервалу.",
    kind: "value",
    fromConfig: (r) => r.eggIntervalHours,
    parse: hours,
    format: fmtHours,
    apply: (r, v) => { r.eggIntervalHours = v as number; },
  },
  {
    key: "shop.eggPricesStars",
    title: "Цены яиц в Stars",
    hint: "Цены через пробел по порядку покупок, например: 25 50 100. Сколько чисел — столько покупок до следующего яйца дня.",
    kind: "value",
    fromConfig: (r) => r.shop.eggPricesStars,
    parse: intList(1, 10000, 1, 10),
    format: (v) => (v as number[]).join(" → "),
    apply: (r, v) => { r.shop.eggPricesStars = v as number[]; },
  },
  {
    key: "shop.enabled",
    title: "Покупки за Stars",
    hint: "",
    kind: "bool",
    fromConfig: () => true,
    parse: bool,
    format: (v) => (v ? "включены" : "выключены"),
  },
  {
    key: "shop.adEggsPerDay",
    title: "Яиц за рекламу в день",
    hint: "Число от 0 до 10. 0 — кнопка «Реклама: +1 яйцо» пропадёт.",
    kind: "value",
    fromConfig: (r) => r.shop.adEggsPerDay,
    parse: int(0, 10),
    format: String,
    apply: (r, v) => { r.shop.adEggsPerDay = v as number; },
  },
  {
    key: "craftCosts",
    title: "Цены фигурок в осколках",
    hint: "Три числа: обычная, редкая, эпическая. Например: 30 60 120. Легендарную купить нельзя.",
    kind: "value",
    fromConfig: (r) => r.craftCosts,
    parse: (s) => {
      const [common, rare, epic] = intList(1, 100000, 3, 3)(s);
      return { common, rare, epic } satisfies CraftCosts;
    },
    format: (v) => {
      const c = v as Partial<CraftCosts>;
      return `обычная ${c.common ?? "—"} · редкая ${c.rare ?? "—"} · эпическая ${c.epic ?? "—"}`;
    },
    apply: (r, v) => { r.craftCosts = v as CraftCosts; },
  },
  {
    key: "trading.giftsPerDay",
    title: "Подарков в день",
    hint: "Число от 0 до 50. 0 — подарки выключены.",
    kind: "value",
    fromConfig: (r) => r.trading.giftsPerDay,
    parse: int(0, 50),
    format: String,
    apply: (r, v) => { r.trading.giftsPerDay = v as number; },
  },
  {
    key: "pityThreshold",
    title: "Гарант новинки",
    hint: "Сколько яиц подряд без новой фигурки, после чего следующее точно даст новую. Число от 1 до 50.",
    kind: "value",
    fromConfig: (r) => r.pityThreshold,
    parse: int(1, 50),
    format: (v) => `${v} яиц`,
    apply: (r, v) => { r.pityThreshold = v as number; },
  },
  {
    key: "streakFreezesPerWeek",
    title: "Заморозок серии в неделю",
    hint: "Число от 0 до 7.",
    kind: "value",
    fromConfig: (r) => r.streakFreezesPerWeek,
    parse: int(0, 7),
    format: String,
    apply: (r, v) => { r.streakFreezesPerWeek = v as number; },
  },
  {
    key: "events.dropChance",
    title: "Шанс фигурки события",
    hint: "Процент от 0 до 100. Применяется ко всем событиям сезона, пока они идут.",
    kind: "value",
    fromConfig: (r) => Math.round((r.events?.[0]?.dropChance ?? 0) * 100),
    parse: int(0, 100),
    format: (v) => `${v}%`,
    apply: (r, v) => { r.events?.forEach((e) => { e.dropChance = (v as number) / 100; }); },
  },
  {
    key: "ads.enabled",
    title: "Реклама в игре",
    hint: "",
    kind: "bool",
    fromConfig: () => true,
    parse: bool,
    format: (v) => (v ? "включена" : "выключена"),
  },
  {
    key: "maintenance",
    title: "Техработы",
    hint: "",
    kind: "bool",
    fromConfig: () => false,
    parse: bool,
    format: (v) => (v ? "игра закрыта" : "выключены"),
  },
];

export const settingByKey = (key: string) => SETTINGS.find((s) => s.key === key);

// Кэш на 10 секунд, чтобы не ходить в БД на каждый запрос игрока
const CACHE_MS = 10_000;
let cache: { at: number; values: Map<string, unknown> } | null = null;

export async function getOverrides(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values;
  const rows = await prisma.setting.findMany();
  cache = { at: Date.now(), values: new Map(rows.map((r) => [r.key, r.value])) };
  return cache.values;
}

export function invalidateSettings() {
  cache = null;
}

export async function effectiveRules(stored: StoredRules): Promise<StoredRules> {
  const rules = structuredClone(stored);
  const overrides = await getOverrides();
  for (const def of SETTINGS) {
    if (def.apply && overrides.has(def.key)) def.apply(rules, overrides.get(def.key));
  }
  return rules;
}

export async function getFlag(key: "ads.enabled" | "maintenance" | "shop.enabled"): Promise<boolean> {
  const overrides = await getOverrides();
  return overrides.has(key) ? Boolean(overrides.get(key)) : (settingByKey(key)!.fromConfig({} as StoredRules) as boolean);
}

export async function currentValue(def: SettingDef, stored: StoredRules) {
  const overrides = await getOverrides();
  const overridden = overrides.has(def.key);
  return { value: overridden ? overrides.get(def.key) : def.fromConfig(stored), overridden };
}

export async function setSetting(key: string, value: unknown, adminId: number) {
  await prisma.$transaction([
    prisma.setting.upsert({
      where: { key },
      create: { key, value: value as object, updatedBy: BigInt(adminId) },
      update: { value: value as object, updatedBy: BigInt(adminId) },
    }),
    prisma.adminLog.create({ data: { adminId: BigInt(adminId), action: "setting.set", payload: { key, value: value as object } } }),
  ]);
  invalidateSettings();
}

export async function resetSetting(key: string, adminId: number) {
  await prisma.$transaction([
    prisma.setting.deleteMany({ where: { key } }),
    prisma.adminLog.create({ data: { adminId: BigInt(adminId), action: "setting.reset", payload: { key } } }),
  ]);
  invalidateSettings();
}
