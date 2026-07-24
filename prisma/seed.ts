/**
 * Seed the database from `prisma/seed-data.json`.
 *
 * That file is a snapshot of the original SQLite database, exported when the
 * project moved to Supabase Postgres so the demo data (and the role
 * assignments made since) survived the migration intact.
 *
 * The previous version of this script generated data inline and imported from
 * `@/lib/db`, a Next.js path alias that does not resolve when Prisma runs the
 * seed outside the bundler.
 *
 * Idempotent: every row is upserted by primary key, so re-running against an
 * already-seeded database is safe.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const db = new PrismaClient();

/**
 * Insert order matters — a row cannot reference a parent that does not exist
 * yet. Roles precede users, users precede what they own, and purchase-order
 * items come last because they depend on both orders and products.
 */
const ORDER = [
  'role', 'user', 'company', 'contact', 'lead', 'deal',
  'project', 'projectTask', 'workspacePage', 'channel', 'message',
  'supportTicket', 'leaveRequest', 'invoice', 'expense',
  'warehouse', 'supplier', 'product', 'stockMovement',
  'purchaseOrder', 'purchaseOrderItem', 'calendarEvent',
  'notification', 'activityLog', 'auditLog', 'setting',
] as const;

/** Columns Prisma expects as Date but JSON carries as ISO strings. */
const DATE_FIELDS = new Set([
  'createdAt', 'updatedAt', 'lastSeen', 'date', 'dueDate', 'paidAt',
  'startDate', 'endDate', 'closeDate', 'orderDate', 'expectedDate',
  'receivedAt', 'reviewedAt', 'joinedAt', 'invitedAt', 'expiresAt', 'acceptedAt',
]);

function revive(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = DATE_FIELDS.has(k) && typeof v === 'string' ? new Date(v) : v;
  }
  return out;
}

async function main() {
  const path = join(process.cwd(), 'prisma', 'seed-data.json');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<
    string,
    Record<string, unknown>[]
  >;

  let inserted = 0;
  let skipped = 0;

  for (const model of ORDER) {
    const rows = raw[model];
    if (!rows?.length) continue;

    const delegate = (db as any)[model];
    if (!delegate?.upsert) continue;

    let ok = 0;
    for (const row of rows) {
      const data = revive(row);
      try {
        await delegate.upsert({ where: { id: data.id }, update: data, create: data });
        ok++; inserted++;
      } catch (e: any) {
        // Report the offending row rather than aborting the run: partial data
        // is more useful than none, and the message names exactly what failed.
        skipped++;
        console.warn(`  ! ${model}[${String(data.id)}]: ${String(e.message).split('\n')[0]}`);
      }
    }
    console.log(`  ${model.padEnd(20)} ${ok}/${rows.length}`);
  }

  console.log(`\nSeeded ${inserted} row(s)${skipped ? `, ${skipped} skipped` : ''}.`);
}

main()
  .catch(e => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
