/**
 * Напоминания о питомце от игрового бота: хочет есть, хочет в ванну, скучает, хочет спать, выспался.
 * Раз в 10 минут проверяем «живых» питомцев (главных и общих питомцев пати). Про каждую нужду пишем
 * один раз, пока её не закроют; не чаще раза в 3 часа на питомца и не ночью (23:00–9:00 по Москве).
 * Общий питомец пати — пишем обоим.
 */
import type { Api } from "grammy";
import type { Pet, User } from "@prisma/client";
import { prisma } from "../db.js";
import { tick } from "../game/pets.js";
import { notifyUser } from "./game-bot.js";

const HOUR = 3600_000, GAP = 3 * HOUR;
type Need = "food" | "clean" | "mood" | "energy" | "woke";
const LINE: Record<Need, string> = {
  food: "🍓 хочет есть", clean: "🫧 хочет в ванну", mood: "💛 скучает и ждёт игры", energy: "🌙 очень хочет спать", woke: "☀️ уже не спит и ждёт вас",
};

/** Какие нужды сейчас есть и какие уже закрыты (с запасом, чтобы не дёргать туда-сюда) */
export function needsOf(before: Pet, now: Date) {
  const p = { ...before }; tick(p, now);
  const on: Record<Need, boolean> = {
    food: p.food < 25, clean: p.clean < 25, mood: p.mood < 25, energy: !p.asleep && p.energy < 15, woke: before.asleep && !p.asleep,
  };
  const off: Record<Need, boolean> = {
    food: p.food >= 40, clean: p.clean >= 40, mood: p.mood >= 40, energy: p.asleep || p.energy >= 40, woke: !before.asleep,
  };
  return { on, off };
}

const quiet = (now: Date) => { const h = (now.getUTCHours() + 3) % 24; return h >= 23 || h < 9; };
const canWrite = (u: User | null) => !!u && u.notificationsEnabled && u.petNotify && !u.botBlocked && !u.isBanned;

export async function notifyPets(api: Api, webAppUrl: string, now = new Date(), figureName: (code: string) => Promise<string>) {
  if (quiet(now)) return 0;
  let sent = 0, cursor = 0;
  for (;;) {
    const pets = await prisma.pet.findMany({
      where: { id: { gt: cursor }, activeSince: { not: null }, OR: [{ lastNotifyAt: null }, { lastNotifyAt: { lt: new Date(now.getTime() - GAP) } }] },
      include: { user: true, pair: { include: { owner: true, partner: true } } },
      orderBy: { id: "asc" }, take: 300,
    });
    if (!pets.length) break;
    cursor = pets[pets.length - 1].id;
    for (const pet of pets) {
      // Личный питомец живёт, только пока он главный у хозяина
      if (pet.userId && pet.user?.activePet !== pet.figureCode) continue;
      const to = (pet.pair ? [pet.pair.owner, pet.pair.partner] : [pet.user]).filter(canWrite) as User[];
      const flags = { ...(pet.notified as Partial<Record<Need, boolean>>) };
      const { on, off } = needsOf(pet, now);
      const fresh: Need[] = [];
      for (const n of Object.keys(LINE) as Need[]) {
        if (on[n] && !flags[n]) fresh.push(n);
        if (off[n]) delete flags[n];
      }
      if (fresh.length && to.length) {
        const name = await figureName(pet.figureCode);
        const head = pet.pair ? `💞 Ваш общий питомец ${name}` : `🏠 ${name}`;
        const text = `${head}:\n${fresh.map((n) => LINE[n]).join("\n")}\n\nЗагляните в игру!`;
        for (const u of to) if (await notifyUser(api, webAppUrl, u.id, text, { text: "🏠 К питомцу", hash: "pet" })) sent++;
        fresh.forEach((n) => (flags[n] = true));
        await prisma.pet.update({ where: { id: pet.id }, data: { notified: flags, lastNotifyAt: now } });
        await new Promise((r) => setTimeout(r, 40));
      } else if (JSON.stringify(flags) !== JSON.stringify(pet.notified)) {
        await prisma.pet.update({ where: { id: pet.id }, data: { notified: flags } });
      }
    }
  }
  return sent;
}
