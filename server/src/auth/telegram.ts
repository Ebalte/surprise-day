/**
 * Проверка подписи Telegram.
 * - Mini App: initData подписан ключом HMAC_SHA256("WebAppData", BOT_TOKEN)
 *   https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * - Сайт: виджет «Войти через Telegram» подписан ключом SHA256(BOT_TOKEN)
 *   https://core.telegram.org/widgets/login#checking-authorization
 * - Свои сессии для сайта: base64url(payload).hmac(SESSION_SECRET)
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
};

export class AuthError extends Error {}

const safeEqualHex = (a: string, b: string) => {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

const checkString = (entries: [string, string][]) =>
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");

export function verifyInitData(initData: string, botToken: string, maxAgeSec: number, now = Date.now()) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new AuthError("В initData нет подписи");
  params.delete("hash");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString([...params.entries()])).digest("hex");
  if (!safeEqualHex(hash, expected)) throw new AuthError("Подпись initData не совпадает");
  const authDate = Number(params.get("auth_date"));
  if (!authDate || now / 1000 - authDate > maxAgeSec) throw new AuthError("initData устарела, перезапустите игру");
  const rawUser = params.get("user");
  if (!rawUser) throw new AuthError("В initData нет пользователя");
  return { user: JSON.parse(rawUser) as TgUser, startParam: params.get("start_param") ?? undefined };
}

export function verifyLoginWidget(data: Record<string, unknown>, botToken: string, maxAgeSec: number, now = Date.now()): TgUser {
  const { hash, ...rest } = data;
  if (typeof hash !== "string") throw new AuthError("Нет подписи");
  const entries = Object.entries(rest).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)] as [string, string]);
  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString(entries)).digest("hex");
  if (!safeEqualHex(hash, expected)) throw new AuthError("Подпись входа не совпадает");
  const authDate = Number(rest.auth_date);
  if (!authDate || now / 1000 - authDate > maxAgeSec) throw new AuthError("Данные входа устарели, войдите ещё раз");
  return {
    id: Number(rest.id),
    first_name: rest.first_name as string | undefined,
    last_name: rest.last_name as string | undefined,
    username: rest.username as string | undefined,
    photo_url: rest.photo_url as string | undefined,
  };
}

export function signSession(userId: number, secret: string, ttlDays: number, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + ttlDays * 86400_000 })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string, secret: string, now = Date.now()): number {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) throw new AuthError("Неверная сессия");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AuthError("Неверная сессия");
  const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid: number; exp: number };
  if (exp < now) throw new AuthError("Сессия истекла, войдите ещё раз");
  return uid;
}

/** Для тестов и dev: собрать initData с правильной подписью */
export function buildInitData(user: TgUser, botToken: string, extra: Record<string, string> = {}, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user), ...extra });
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secret).update(checkString([...params.entries()])).digest("hex"));
  return params.toString();
}
