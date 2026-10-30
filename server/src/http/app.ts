/**
 * HTTP API игры. Каждый запрос /api/* (кроме входа и картинок рекламы) проходит проверку:
 *   Authorization: tma <initData>   — из Telegram Mini App, подпись проверяется на каждом запросе
 *   Authorization: Bearer <session> — с сайта, после входа через виджет Telegram
 */
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import type { Api, Bot } from "grammy";
import { webhookCallback } from "grammy";
import type { User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import type { Env } from "../env.js";
import { AuthError, signSession, verifyInitData, verifyLoginWidget, verifySession } from "../auth/telegram.js";
import { GameError, craftFigure, openEgg } from "../game/core.js";
import { claimGift, displayName, friendsView, proposeTrade, respondTrade, sendGift, upsertTgUser } from "../game/social.js";
import { claimQuest, gameState, leaderboard, setFrame } from "../game/state.js";
import { createEggInvoice } from "../game/shop.js";
import { loadStory, saveStory } from "../game/stories.js";
import { FOOD, GAMES, buyFood, feedPet, finishGame, patPet, setActivePet, sleepPet, startGame, washPet, type FoodKey } from "../game/pets.js";
import { getFlag } from "../settings/service.js";
import { AdError, completeAdView, fetchAdMedia, pickAd, publicAd, registerAdClick, startAdView } from "../ads/service.js";
import { notifyUser } from "../bot/game-bot.js";

declare module "fastify" {
  interface FastifyRequest { user: User }
}

export type AppDeps = { env: Env; botApi: Api; bot?: Bot };

export function buildApp({ env, botApi, bot }: AppDeps) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: true });
  const origins = [new URL(env.WEB_APP_URL).origin, ...(env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
  app.register(cors, { origin: origins, allowedHeaders: ["Authorization", "Content-Type"], methods: ["GET", "POST"] });

  const notify = (userId: number, text: string) => void notifyUser(botApi, env.WEB_APP_URL, userId, text);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GameError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof AdError) return reply.status(409).send({ error: err.code, message: err.message });
    if (err instanceof AuthError) return reply.status(401).send({ error: "auth", message: err.message });
    if (err instanceof z.ZodError) return reply.status(400).send({ error: "bad_request", message: "Неверные данные запроса" });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: "server", message: status >= 500 ? "Что-то пошло не так. Попробуйте ещё раз" : (err as Error).message });
  });

  // ---------- авторизация ----------
  async function authenticate(req: FastifyRequest) {
    const h = req.headers.authorization ?? "";
    let user: User | null = null;
    if (h.startsWith("tma ")) {
      const { user: tg, startParam } = verifyInitData(h.slice(4), env.BOT_TOKEN, env.INIT_DATA_MAX_AGE_SEC);
      user = (await upsertTgUser(tg, startParam)).user;
    } else if (h.startsWith("Bearer ")) {
      user = await prisma.user.findUnique({ where: { id: verifySession(h.slice(7), env.SESSION_SECRET) } });
    } else if (env.DEV_LOGIN && h.startsWith("Dev ")) {
      const [id, ref] = h.slice(4).split(":");
      user = (await upsertTgUser({ id: Number(id), first_name: "Тестовый", last_name: `игрок ${id}` }, ref)).user;
    }
    if (!user) throw new AuthError("Войдите через Telegram");
    if (user.isBanned) throw new GameError("banned", "Аккаунт заблокирован", 403);
    req.user = user;
  }
  const open = new Set(["/api/auth/widget", "/health"]);
  app.addHook("preHandler", async (req) => {
    const path = req.routeOptions.url ?? "";
    if (!path.startsWith("/api/") || open.has(path) || path.startsWith("/api/ads/:id/media") || path === "/api/stories/:file") return;
    await authenticate(req);
  });
  const notInMaintenance = async () => {
    if (await getFlag("maintenance")) throw new GameError("maintenance", "Игра на техработах. Скоро вернёмся", 503);
  };
  const id = (req: FastifyRequest) => z.coerce.number().int().positive().parse((req.params as { id: string }).id);
  const body = <T extends z.ZodTypeAny>(schema: T, req: FastifyRequest) => schema.parse(req.body ?? {}) as z.infer<T>;
  const links = { BOT_USERNAME: env.BOT_USERNAME, MINI_APP_SHORT_NAME: env.MINI_APP_SHORT_NAME, WEB_APP_URL: env.WEB_APP_URL };
  const fresh = (req: FastifyRequest) => prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });

  app.get("/health", async () => ({ ok: true }));

  // Вход на сайте через виджет Telegram → своя сессия
  app.post("/api/auth/widget", async (req) => {
    const { data, ref } = body(z.object({ data: z.record(z.unknown()), ref: z.union([z.string(), z.number()]).optional() }), req);
    const tg = verifyLoginWidget(data, env.BOT_TOKEN, env.AUTH_MAX_AGE_SEC);
    const { user } = await upsertTgUser(tg, ref);
    if (user.isBanned) throw new GameError("banned", "Аккаунт заблокирован", 403);
    return { token: signSession(user.id, env.SESSION_SECRET, env.SESSION_TTL_DAYS) };
  });

  // ---------- игра ----------
  app.get("/api/state", async (req) => gameState(await fresh(req), links));

  app.post("/api/eggs/open", async (req) => {
    await notInMaintenance();
    const { result, notify: messages } = await openEgg(req.user.id);
    messages.forEach((m) => notify(m.userId, m.text));
    return result;
  });

  app.post("/api/craft", async (req) => {
    await notInMaintenance();
    return craftFigure(req.user.id, body(z.object({ code: z.string() }), req).code);
  });

  app.post("/api/quests/:code/claim", async (req) => claimQuest(req.user.id, (req.params as { code: string }).code));
  app.post("/api/frame", async (req) => { await setFrame(req.user.id, body(z.object({ code: z.string().nullable() }), req).code); return { ok: true }; });
  app.post("/api/notifications", async (req) => {
    const { enabled } = body(z.object({ enabled: z.boolean() }), req);
    await prisma.user.update({ where: { id: req.user.id }, data: { notificationsEnabled: enabled, ...(enabled ? { botBlocked: false } : {}) } });
    return { ok: true };
  });
  app.get("/api/leaderboard", async (req) => leaderboard(req.user.id));

  // ---------- друзья, подарки, обмен ----------
  app.get("/api/friends", async (req) => friendsView(req.user.id));

  app.post("/api/gifts", async (req) => {
    await notInMaintenance();
    const { to, code } = body(z.object({ to: z.number().int(), code: z.string() }), req);
    const r = await sendGift(req.user.id, to, code);
    notify(to, `🎁 ${displayName(req.user)} дарит вам «${r.figure.name}». Заберите подарок в разделе «Друзья».`);
    return { ok: true };
  });
  app.post("/api/gifts/:id/claim", async (req) => { await notInMaintenance(); return claimGift(req.user.id, id(req)); });

  app.post("/api/trades", async (req) => {
    await notInMaintenance();
    const { to, give, want } = body(z.object({ to: z.number().int(), give: z.string(), want: z.string() }), req);
    const r = await proposeTrade(req.user.id, to, give, want);
    notify(to, `🔄 ${displayName(req.user)} предлагает обмен: свою «${r.give.name}» за вашу «${r.want.name}».`);
    return { id: r.trade.id };
  });
  for (const action of ["accept", "decline", "cancel"] as const) {
    app.post(`/api/trades/:id/${action}`, async (req) => {
      await notInMaintenance();
      const r = await respondTrade(req.user.id, id(req), action);
      if (r.accepted) notify(r.trade.fromUserId, `✅ ${displayName(req.user)} принял(а) обмен. Вы получили «${r.trade.wantFigure.name}».`);
      return r.accepted ? { accepted: true, figure: r.trade.giveFigure.code, ...r.forMe } : { accepted: false };
    });
  }

  // ---------- питомец и мини-игры ----------
  const food = z.enum(Object.keys(FOOD) as [FoodKey, ...FoodKey[]]);
  app.post("/api/pet/active", async (req) => { await notInMaintenance(); return setActivePet(req.user.id, body(z.object({ code: z.string() }), req).code); });
  app.post("/api/pet/buy", async (req) => { await notInMaintenance(); return buyFood(req.user.id, body(z.object({ item: food }), req).item); });
  app.post("/api/pet/feed", async (req) => { await notInMaintenance(); return feedPet(req.user.id, body(z.object({ item: food }), req).item); });
  app.post("/api/pet/wash", async (req) => { await notInMaintenance(); return washPet(req.user.id); });
  app.post("/api/pet/pat", async (req) => patPet(req.user.id));
  app.post("/api/pet/sleep", async (req) => { await notInMaintenance(); return sleepPet(req.user.id, body(z.object({ asleep: z.boolean() }), req).asleep); });
  app.post("/api/games/start", async (req) => { await notInMaintenance(); return startGame(req.user.id, body(z.object({ game: z.enum(GAMES) }), req).game); });
  app.post("/api/games/:id/finish", async (req) => finishGame(req.user.id, id(req), body(z.object({ score: z.number().int().min(0).max(100000) }), req).score));

  // Картинка сторис: загрузка игроком и публичная раздача для Telegram
  app.post("/api/stories", { bodyLimit: 2_500_000 }, async (req) => saveStory(req.user.id, body(z.object({ image: z.string().max(2_400_000) }), req).image));
  app.get("/api/stories/:file", async (req, reply: FastifyReply) => {
    const story = await loadStory(((req.params as { file: string }).file).replace(/\.jpg$/, ""));
    if (!story) return reply.status(404).send();
    reply.header("Content-Type", "image/jpeg");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(Buffer.from(story.data));
  });

  // ---------- магазин (Stars) ----------
  app.post("/api/shop/invoice", async (req) => {
    await notInMaintenance();
    return createEggInvoice(botApi, await fresh(req));
  });

  // ---------- реклама ----------
  app.get("/api/ads/banner", async () => {
    const ad = await pickAd("BANNER");
    if (!ad) return { ad: null };
    await prisma.adCampaign.update({ where: { id: ad.id }, data: { impressions: { increment: 1 } } });
    return { ad: publicAd(ad) };
  });
  app.post("/api/ads/start", async (req) => { await notInMaintenance(); return startAdView(req.user.id); });
  app.post("/api/ads/:id/complete", async (req) => { await notInMaintenance(); return completeAdView(req.user.id, id(req)); });
  app.post("/api/ads/click", async (req) => {
    const { campaignId, viewId } = body(z.object({ campaignId: z.number().int(), viewId: z.number().int().optional() }), req);
    await registerAdClick(req.user.id, campaignId, viewId);
    return { ok: true };
  });
  app.get("/api/ads/:id/media", async (req, reply: FastifyReply) => {
    const ad = await prisma.adCampaign.findUnique({ where: { id: id(req) } });
    if (!ad?.mediaFileId || !env.ADMIN_BOT_TOKEN) return reply.status(404).send();
    const res = await fetchAdMedia(ad, env.ADMIN_BOT_TOKEN);
    if (!res.ok) return reply.status(502).send();
    reply.header("Content-Type", res.headers.get("content-type") ?? (ad.mediaType === "video" ? "video/mp4" : "image/jpeg"));
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send(Buffer.from(await res.arrayBuffer()));
  });

  // ---------- вебхук игрового бота ----------
  if (bot && env.BOT_MODE === "webhook") {
    app.post("/telegram/webhook", webhookCallback(bot, "fastify", { secretToken: env.WEBHOOK_SECRET }));
  }

  return app;
}
