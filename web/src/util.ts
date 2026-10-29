import type { Rarity } from "./api";
import { API_URL } from "./api";

export const RLABEL: Record<Rarity, string> = { common: "Обычная", rare: "Редкая", epic: "Эпическая", legendary: "Легендарная" };
export const RPLURAL: Record<Rarity, string> = { common: "Обычные", rare: "Редкие", epic: "Эпические", legendary: "Легендарная" };
export const ORDER: Rarity[] = ["common", "rare", "epic", "legendary"];
export const HOUR = 3600_000, DAY = 86400_000;

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
export function fmtTimer(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
}
export function dur(ms: number) {
  ms = Math.max(0, ms);
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR);
  return d ? `${d} ${plural(d, "день", "дня", "дней")} ${h} ч` : `${h} ч ${Math.floor((ms % HOUR) / 60000)} мин`;
}

/** Путь из конфига сезона → URL. "/figures/x.svg" лежит в web/public, полный URL — как есть. */
export function asset(path: string | null | undefined) {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith("/api/")) return API_URL + path;
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
}
