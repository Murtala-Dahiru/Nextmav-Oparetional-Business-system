import { PrismaClient } from '@prisma/client'

/**
 * Prisma client.
 *
 * `.env` is gitignored (it must never be committed), so a freshly cloned or
 * freshly deployed instance has no `DATABASE_URL` and every query fails with
 * "Environment variable not found: DATABASE_URL" — which surfaces as a broken
 * dashboard rather than an obvious configuration error.
 *
 * Falling back to the SQLite database that ships with the repository means a
 * clone runs immediately. A real deployment should still set `DATABASE_URL`
 * explicitly; this is a safe default, not a substitute for configuration.
 */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:../db/custom.db'
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : [],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Whether the database is actually reachable.
 *
 * Used by routes that would otherwise return an opaque 500. A serverless host
 * with a read-only filesystem, or a missing/unmigrated database, should produce
 * a message that names the problem instead of a blank screen.
 */
export async function checkDatabase(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await db.$queryRaw`SELECT 1`
    return { ok: true }
  } catch (e: any) {
    const raw = String(e?.message ?? e)
    if (raw.includes('Environment variable not found')) {
      return { ok: false, message: 'DATABASE_URL is not set on this deployment.' }
    }
    if (raw.includes('Unable to open the database file') || raw.includes('code: 14')) {
      return {
        ok: false,
        message:
          'The database file could not be opened. On a read-only or ephemeral host (most serverless platforms) SQLite will not work — point DATABASE_URL at a hosted database instead.',
      }
    }
    if (raw.includes('did not initialize yet') || raw.includes('prisma generate')) {
      return {
        ok: false,
        message: 'The Prisma client was not generated during the build. Run `prisma generate`.',
      }
    }
    return { ok: false, message: raw.split('\n').filter(Boolean)[0] ?? 'Database unavailable.' }
  }
}
