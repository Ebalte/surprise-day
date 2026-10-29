import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type RarityKey = (typeof RARITIES)[number];

const rarityKey = z.enum(RARITIES);

const rulesSchema = z.object({
  rarities: z.record(
    rarityKey,
    z.object({
      weight: z.number().min(0),
      shards: z.number().int().min(0),
    }),
  ),
  /// Сколько часов между бесплатными яйцами (по умолчанию сутки). Можно дробное: 0.5 = 30 минут.
  eggIntervalHours: z.number().min(0.25).max(168).default(24),
  pityThreshold: z.number().int().min(1),
  /// С какого числа оставшихся яиц показывать «новинка гарантирована в ближайших N яйцах»
  pityHintFrom: z.number().int().min(0).default(3),
  /// Цена недостающей фигурки в осколках по редкости. Редкости, которой нет в списке
  /// (по умолчанию легендарной), за осколки купить нельзя.
  craftCosts: z.record(rarityKey, z.number().int().min(1)),
  streakFreezesPerWeek: z.number().int().min(0).default(1),
  trading: z
    .object({
      giftsPerDay: z.number().int().min(0),
      tradeableRarities: z.array(rarityKey),
      offerTtlHours: z.number().min(1),
    })
    .default({ giftsPerDay: 3, tradeableRarities: ["common", "rare", "epic"], offerTtlHours: 48 }),
  shop: z
    .object({
      /// Цена каждой следующей покупки: 1-е яйцо 25, 2-е 50, 3-е 100.
      /// Число элементов = лимит покупок. Счётчик сбрасывается, когда игрок открывает новое яйцо дня.
      eggPricesStars: z.array(z.number().int().min(1)).min(1),
      adEggsPerDay: z.number().int().min(0),
    })
    .default({ eggPricesStars: [25, 50, 100], adEggsPerDay: 1 }),
  quests: z
    .array(
      z.object({
        code: z.string().regex(/^[a-z0-9_-]+$/),
        title: z.string().min(1),
        event: z.enum(["egg_opened", "new_figure", "gift_sent", "trade_done"]),
        goal: z.number().int().min(1),
        shards: z.number().int().min(0),
      }),
    )
    .default([]),
});
export type SeasonRules = z.infer<typeof rulesSchema>;

const figureSchema = z.object({
  code: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1),
  rarity: rarityKey,
  image: z.string().min(1),
  description: z.string().optional(),
});

const rewardSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("egg"), minRarity: rarityKey.optional() }),
  z.object({ type: z.literal("shards"), amount: z.number().int().min(1) }),
]);
export type Reward = z.infer<typeof rewardSchema>;

const badgeSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
});

const albumSchema = z
  .object({
    rows: z.array(z.object({ figures: z.array(z.string()).min(1), reward: rewardSchema })),
    sets: z.array(
      z.object({
        code: z.string().regex(/^[a-z0-9_-]+$/),
        title: z.string().min(1),
        /// Если не указана — набор включает все фигурки сезона
        rarity: rarityKey.optional(),
        frame: z.object({ code: z.string().min(1), title: z.string().min(1), color: z.string() }),
      }),
    ),
  })
  .default({ rows: [], sets: [] });

const eventSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_-]+$/),
  title: z.string().min(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  /// Шанс, что яйцо во время события даст фигурку события вместо обычной
  dropChance: z.number().min(0).max(1),
  badge: badgeSchema,
  reward: rewardSchema.optional(),
  figures: z.array(figureSchema).min(1),
});

export const seasonConfigSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9_-]+$/),
    number: z.number().int().min(1),
    title: z.string().min(1),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullable().optional(),
    isActive: z.boolean(),
    rules: rulesSchema,
    badge: badgeSchema,
    figures: z.array(figureSchema).min(1),
    album: albumSchema,
    events: z.array(eventSchema).default([]),
  })
  .superRefine((cfg, ctx) => {
    const codes = new Set<string>();
    const allFigures = [...cfg.figures, ...cfg.events.flatMap((e) => e.figures)];
    for (const f of allFigures) {
      if (codes.has(f.code)) {
        ctx.addIssue({ code: "custom", message: `Дубликат кода фигурки "${f.code}" (коды общие для сезона и событий)` });
      }
      codes.add(f.code);
      if (!cfg.rules.rarities[f.rarity]) {
        ctx.addIssue({
          code: "custom",
          message: `Фигурка "${f.code}" имеет редкость "${f.rarity}", для которой нет правил в rules.rarities`,
        });
      }
    }
    // Каждая редкость с весом > 0 должна иметь хотя бы одну фигурку,
    // иначе ролл может попасть в пустую корзину.
    for (const [rarity, r] of Object.entries(cfg.rules.rarities)) {
      if (r.weight > 0 && !cfg.figures.some((f) => f.rarity === rarity)) {
        ctx.addIssue({ code: "custom", message: `Редкость "${rarity}" имеет вес, но в ней нет фигурок` });
      }
    }
    const seasonCodes = new Set(cfg.figures.map((f) => f.code));
    cfg.album.rows.forEach((row, i) => {
      for (const c of row.figures) {
        if (!seasonCodes.has(c)) ctx.addIssue({ code: "custom", message: `album.rows[${i}]: нет фигурки сезона "${c}"` });
      }
    });
    const slugs = new Set<string>();
    for (const e of cfg.events) {
      if (slugs.has(e.slug)) ctx.addIssue({ code: "custom", message: `Дубликат события "${e.slug}"` });
      slugs.add(e.slug);
      if (e.endsAt <= e.startsAt) ctx.addIssue({ code: "custom", message: `Событие "${e.slug}": endsAt раньше startsAt` });
    }
  });
export type SeasonConfig = z.infer<typeof seasonConfigSchema>;

/** Ищет папку seasons/: $SEASONS_DIR, ./seasons или ../seasons от cwd */
export function resolveSeasonsDir(): string {
  const candidates = [
    process.env.SEASONS_DIR,
    path.resolve(process.cwd(), "seasons"),
    path.resolve(process.cwd(), "..", "seasons"),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  throw new Error(`Папка seasons/ не найдена. Проверены: ${candidates.join(", ")}`);
}

export function loadSeasonConfigs(dir = resolveSeasonsDir()): SeasonConfig[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".schema.json"))
    .sort();

  const configs = files.map((file) => {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const parsed = seasonConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Ошибка в ${file}:\n${issues}`);
    }
    return parsed.data;
  });

  const active = configs.filter((c) => c.isActive);
  if (active.length > 1) {
    throw new Error(`Активным может быть только один сезон, сейчас: ${active.map((c) => c.slug).join(", ")}`);
  }
  return configs;
}
