/** Клиент API. Внутри Telegram подписываем каждый запрос initData, на сайте — токеном сессии. */
import { inTelegram, wa } from "./tg";

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN_KEY = "surprise-day-token";
const DEV_KEY = "surprise-day-dev";

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

export function authHeader(): string | null {
  if (inTelegram) return `tma ${wa!.initData}`;
  const token = store.get(TOKEN_KEY);
  if (token) return `Bearer ${token}`;
  const dev = store.get(DEV_KEY);
  return dev ? `Dev ${dev}` : null;
}
export const isLoggedIn = () => !!authHeader();
export const saveToken = (t: string | null) => store.set(TOKEN_KEY, t);
export const devLogin = (id: number, ref?: string) => store.set(DEV_KEY, ref ? `${id}:${ref}` : String(id));
export function logout() { store.set(TOKEN_KEY, null); store.set(DEV_KEY, null); }

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const auth = authHeader();
  if (auth) headers.Authorization = auth;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("network", "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !inTelegram) saveToken(null);
    throw new ApiError(data.error ?? "server", data.message ?? "Что-то пошло не так", res.status);
  }
  return data as T;
}

export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, body);

// ------------------------------------------------------------------ типы ответов

export type Rarity = "common" | "rare" | "epic" | "legendary";
export type FigureDto = { code: string; name: string; rarity: Rarity; image: string; description?: string | null; event?: string | null };
export type Reward = { type: "egg"; minRarity?: Rarity } | { type: "shards"; amount: number };

export type GameState = {
  serverTime: string;
  flags: { maintenance: boolean };
  me: { id: number; name: string; username: string | null; photoUrl: string | null; shards: number; streak: number; bestStreak: number; totalEggs: number; freezeAvailable: boolean; notificationsEnabled: boolean; activeFrame: string | null };
  season: {
    slug: string; title: string; badge: { code: string; title: string; icon: string | null };
    figures: FigureDto[]; mainCount: number;
    rules: { rarities: Record<Rarity, { weight: number; shards: number }>; eggIntervalHours: number; pityThreshold: number; pityHintFrom: number; craftCosts: Partial<Record<Rarity, number>>; trading: { giftsPerDay: number; tradeableRarities: Rarity[]; offerTtlHours: number }; streakFreezesPerWeek: number };
    album: { rows: { figures: string[]; reward: Reward }[]; sets: { code: string; title: string; rarity?: Rarity; frame: { code: string; title: string; color: string } }[] };
    events: { slug: string; title: string; startsAt: string; endsAt: string; dropChance: number; figureCodes: string[]; badge: { code: string; title: string; icon?: string }; active: boolean }[];
  };
  collection: Record<string, number>;
  progress: { dryStreak: number; unique: number; startedAt: string | null; completedAt: string | null };
  eggs: { freeAvailable: boolean; nextFreeAt: string; grants: { id: number; source: string; label: string; minRarity: Rarity | null }[] };
  shop: { enabled: boolean; prices: number[]; used: number; left: number; nextPrice: number | null };
  ads: { rewarded: boolean; left: number; perDay: number };
  quests: { code: string; title: string; goal: number; shards: number; progress: number; claimed: boolean }[];
  weekEndsAt: string;
  rewards: { rows: boolean[]; sets: boolean[] };
  badges: { code: string; title: string; icon: string | null; awardedAt: string }[];
  frames: { code: string; title: string; color: string | null }[];
  refLink: string;
  pet: PetState;
  pair: PairState | null;
};

/** Пати: общий питомец на двоих */
export type PairState = {
  id: number; kind: "couple" | "friends"; role: "owner" | "partner";
  partner: { name: string; photoUrl: string | null } | null;
  inviteCode: string | null; inviteLink: string | null;
  pet: PetDto;
  log: { name: string; action: string; at: string }[];
  today: { meCared: boolean; mateCared: boolean; myPoints: number; matePoints: number; goal: number; rewarded: boolean };
  careStreak: number;
};

export type PetDto = { code: string; level: number; xp: number; needXp: number; food: number; mood: number; clean: number; energy: number; asleep: boolean; ageMs: number; stage: number; active: boolean };
export type PetStage = { fromDays: number; name: string; emoji: string; scale: number; mult: number };
export type FoodDto = { emoji: string; name: string; price: number; food: number; mood: number; toy: boolean };
export type PetState = {
  active: string | null; coins: number; food: Record<string, number>; gameBest: Record<string, number>; gamesPlayed: number;
  pets: PetDto[]; config: { stages: PetStage[]; foods: Record<string, FoodDto>; energyCost: number };
  /** Стили из ссылок-подарков: owned — ["outfit:metal", "room:metal"] */
  style: { owned: string[]; outfit: string | null; room: string | null };
  /** Напоминания бота о питомце */
  notify: boolean;
};
/** Ответ на действие с питомцем: обновлённый питомец и сообщения (новый уровень, подрос) */
export type PetAction<T = object> = { result: T; pet: PetDto; messages: string[] };
export type DayBoard = { rows: { place: number; name: string; score: number; you: boolean; partner: boolean }[]; me: { place: number; score: number } | null; total: number };

export type OpenResult = {
  figure: FigureDto; isNew: boolean; count: number; shards: number; pity: boolean;
  source: string; label: string; minRarity: Rarity | null; streakBonus: boolean; froze: boolean; completedNow: boolean; rewards: string[];
};

export type MiniFig = { code: string; name: string; rarity: Rarity; image: string };
export type FriendsView = {
  qualified: number;
  friends: { id: number; name: string; photoUrl: string | null; qualified: boolean; unique: number; dupes: number; invitedByMe: boolean }[];
  gifts: { id: number; from: string; figure: MiniFig; isNewForMe: boolean }[];
  incoming: { id: number; from: string; get: MiniFig; pay: MiniFig; isNewForMe: boolean; expiresAt: string }[];
  outgoing: { id: number; to: string; give: MiniFig; want: MiniFig; status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED" }[];
  suggestions: { friendId: number; name: string; give: string; get: string }[];
  myDupes: (MiniFig & { count: number })[];
  friendDupes: Record<string, (MiniFig & { count: number; isNewForMe: boolean })[]>;
  friendOwns: Record<string, string[]>;
  giftsLeft: number; giftsPerDay: number; offerTtlHours: number;
};

export type PublicAd = { id: number; placement: "REWARDED" | "BANNER"; text: string; buttonText: string | null; url: string | null; durationSec: number; mediaType: string | null; mediaUrl: string | null };
