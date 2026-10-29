import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/** Начало текущих суток UTC — для дневных лимитов */
export function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
