import { log } from '@/lib/logger';
import { authenticate } from '@/lib/notifications/dispatch-auth';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { Client } from 'pg';
import { dispatchNotifications } from '@/lib/notifications/dispatch';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = authenticate(req);
  if (denied) return denied;
  const connectionString = process.env.NOTIFICATION_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) return Response.json({ error: 'Dispatch configuration unavailable' }, { status: 503 });
  // Never accept organization IDs, SQL, or destinations from the HTTP caller.
  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname, port: Number(url.port) || 5432,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1),
    connectionTimeoutMillis: 10_000, statement_timeout: 15_000,
    ssl: { rejectUnauthorized: true, servername: url.hostname,
      ca: [...rootCertificates, readFileSync(join(process.cwd(), 'scripts/supabase-root-2021.crt'), 'utf8')] },
  });
  try {
    await client.connect();
    return Response.json(await dispatchNotifications(client, undefined, 180_000, false));
  } catch (cause) {
    await client.end().catch(() => {});
    // Provider codes and attempt states are stored in the administrator-only queue tables.
    const code = String((cause as { code?: unknown }).code ?? 'UNKNOWN');
    log.error('notification_dispatch_failed', { code: /^[A-Z0-9_]{1,60}$/.test(code) ? code : 'UNKNOWN' });
    return Response.json({ error: 'Dispatch failed; inspect notification health' }, { status: 503 });
  }
}
