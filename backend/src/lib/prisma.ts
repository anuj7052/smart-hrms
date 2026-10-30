/**
 * Prisma client singleton with connection pool tuning
 *
 * Use this anywhere you need DB access:
 *   import { prisma } from '../lib/prisma';
 *   const users = await prisma.user.findMany();
 */
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prismaClient: PrismaClient | undefined;
}

export const prisma =
  global.prismaClient ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.prismaClient = prisma;
}

export async function connectPrisma(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('[Prisma] Connected to PostgreSQL');
  } catch (err) {
    console.error('[Prisma] Connection failed:', (err as Error).message);
    throw err;
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

// ─── Simple in-memory TTL cache for hot API paths ──────────────────────────
const cache = new Map<string, { data: unknown; expiry: number }>();

export function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiry) { cache.delete(key); return undefined; }
  return entry.data as T;
}

export function setCache(key: string, data: unknown, ttlMs = 30_000): void {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
}

export function invalidateCache(prefix?: string): void {
  if (!prefix) { cache.clear(); return; }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
