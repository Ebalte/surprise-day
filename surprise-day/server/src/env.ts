import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(10, "BOT_TOKEN — токен игрового бота от @BotFather"),
  BOT_USERNAME: z.string().optional(),
  /// short name Mini App из /newapp. Нужен для реферальной ссылки t.me/<бот>/<app>?startapp=ref_<id>
  MINI_APP_SHORT_NAME: z.string().optional(),
  WEB_APP_URL: z.string().url(),
  PUBLIC_API_URL: z.string().url().optional(),
  PORT: z.coerce.number().default(3000),
  /// polling — локально, webhook — на сервере, off — бот не запускается (например, в тестах)
  BOT_MODE: z.enum(["polling", "webhook", "off"]).default("polling"),
  WEBHOOK_SECRET: z.string().optional(),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET — длинная случайная строка"),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  /// Сколько секунд initData из Mini App считается свежей
  INIT_DATA_MAX_AGE_SEC: z.coerce.number().default(86400),
  /// Сколько секунд данные виджета входа на сайте считаются свежими
  AUTH_MAX_AGE_SEC: z.coerce.number().default(300),
  /// Дополнительные адреса фронта для CORS через запятую (по умолчанию — origin из WEB_APP_URL)
  CORS_ORIGINS: z.string().optional(),
  DEV_LOGIN: bool,
  ADMIN_BOT_TOKEN: z.string().optional(),
  ADMIN_IDS: z.string().optional(),
  /// Запускать админ-бота в том же процессе (удобно на бесплатном хостинге с одним сервисом)
  RUN_ADMIN_BOT: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Ошибка в переменных окружения:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const adminIds = (e: Env) =>
  (e.ADMIN_IDS ?? "").split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isInteger);
