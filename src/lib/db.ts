import { PrismaClient } from '@prisma/client'

/**
 * Prisma client (PostgreSQL / Supabase).
 *
 * There is deliberately no fallback connection string. The previous SQLite
 * default let a misconfigured deployment look healthy until the first query;
 * on Postgres a missing `DATABASE_URL` is a configuration error that should be
 * reported plainly by `checkDatabase()` instead of being papered over.
 */

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
          'DATABASE_URL still points at a SQLite file, which cannot work on a serverless host. Set it to your Supabase pooled connection string (port 6543).',
      }
    }
    if (raw.includes("Can't reach database server") || raw.includes('P1001')) {
      return {
        ok: false,
        message:
          'The database server is unreachable. Check that DATABASE_URL uses the Supabase pooled host (port 6543) and that the project is not paused.',
      }
    }
    if (raw.includes('does not exist in the current database') || raw.includes('P2021')) {
      return {
        ok: false,
        message:
          'The database is reachable but empty. Run `npm run db:deploy` to create the tables, then `npm run db:seed`.',
      }
    }
    if (raw.includes('password authentication failed') || raw.includes('P1000')) {
      return { ok: false, message: 'Database credentials were rejected. Re-copy the connection string from Supabase.' }
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
