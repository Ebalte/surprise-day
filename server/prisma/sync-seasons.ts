/**
 * Синхронизирует seasons/*.json → таблицы seasons и figures.
 * Запуск: npm run db:sync-seasons
 *
 * - Новые сезоны и фигурки создаются, существующие обновляются по slug / code.
 * - Фигурки, удалённые из JSON, не удаляются (они есть у игроков), а помечаются isEnabled=false
 *   и больше не выпадают.
 * - Активный сезон в БД всегда ровно тот, что помечен isActive в JSON.
 */
import { PrismaClient, Rarity } from "@prisma/client";
import { loadSeasonConfigs } from "../src/seasons/config.js";

const prisma = new PrismaClient();

async function main() {
  const configs = loadSeasonConfigs();
  if (configs.length === 0) throw new Error("В seasons/ нет ни одного сезона");

  for (const cfg of configs) {
    await prisma.$transaction(async (tx) => {
      const data = {
        number: cfg.number,
        title: cfg.title,
        startsAt: cfg.startsAt,
        endsAt: cfg.endsAt ?? null,
        isActive: cfg.isActive,
        // В rules кладём и альбом, и параметры событий (без фигурок — они в таблице figures)
        rules: {
          ...cfg.rules,
          album: cfg.album,
          events: cfg.events.map(({ figures, ...e }) => ({ ...e, figureCodes: figures.map((f) => f.code) })),
        },
        badgeCode: cfg.badge.code,
        badgeTitle: cfg.badge.title,
        badgeIcon: cfg.badge.icon ?? null,
      };
      const season = await tx.season.upsert({
        where: { slug: cfg.slug },
        create: { slug: cfg.slug, ...data },
        update: data,
      });

      const allFigures = [
        ...cfg.figures.map((f) => ({ ...f, eventSlug: null as string | null })),
        ...cfg.events.flatMap((e) => e.figures.map((f) => ({ ...f, eventSlug: e.slug }))),
      ];
      for (const [i, f] of allFigures.entries()) {
        const fig = {
          eventSlug: f.eventSlug,
          name: f.name,
          rarity: f.rarity.toUpperCase() as Rarity,
          image: f.image,
          description: f.description ?? null,
          sortOrder: i,
          isEnabled: true,
        };
        await tx.figure.upsert({
          where: { seasonId_code: { seasonId: season.id, code: f.code } },
          create: { seasonId: season.id, code: f.code, ...fig },
          update: fig,
        });
      }

      const disabled = await tx.figure.updateMany({
        where: { seasonId: season.id, code: { notIn: allFigures.map((f) => f.code) } },
        data: { isEnabled: false },
      });

      console.log(
        `✔ ${cfg.slug}: ${cfg.figures.length} фигурок, событий: ${cfg.events.length}${disabled.count ? `, отключено ${disabled.count}` : ""}${
          cfg.isActive ? " [АКТИВНЫЙ]" : ""
        }`,
      );
    });
  }

  // Сезоны, которых нет в JSON или которые не помечены активными, — деактивируем
  const activeSlugs = configs.filter((c) => c.isActive).map((c) => c.slug);
  await prisma.season.updateMany({
    where: { slug: { notIn: activeSlugs } },
    data: { isActive: false },
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
