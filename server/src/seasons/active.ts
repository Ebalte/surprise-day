import { prisma } from "../db.js";
import type { Reward, SeasonRules } from "./config.js";
import { effectiveRules } from "../settings/service.js";

/** То, что sync-seasons кладёт в seasons.rules (после JSON даты становятся строками) */
export type StoredRules = SeasonRules & {
  album?: unknown;
  events?: Array<{
    slug: string;
    title: string;
    startsAt: string;
    endsAt: string;
    dropChance: number;
    figureCodes: string[];
    badge: { code: string; title: string; icon?: string };
    reward?: Reward;
  }>;
};

export async function getActiveSeason() {
  const season = await prisma.season.findFirst({ where: { isActive: true } });
  if (!season) throw new Error("Нет активного сезона. Запустите npm run db:sync-seasons");
  return { ...season, rules: season.rules as unknown as StoredRules };
}

/** Правила активного сезона с учётом настроек из админ-бота */
export async function getActiveRules(): Promise<StoredRules> {
  const season = await getActiveSeason();
  return effectiveRules(season.rules);
}
