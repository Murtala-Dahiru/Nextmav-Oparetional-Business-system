/**
 * Apply every migration, in order, to the configured Supabase project.
 *
 *     npm run db:apply
 *
 * Uses a direct Postgres connection (DIRECT_URL) rather than the pooler:
 * DDL cannot run through PgBouncer in transaction mode, and migrations are
 * DDL. Each file runs inside its own transaction, so a failure leaves the
 * database at the last complete migration rather than half-applied.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from './db-connect.mjs';

const DIR = 'supabase/migrations';

function env(key) {
  const raw = readFileSync('.env', 'utf8');
  const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

const url = process.env.DIRECT_URL || env('DIRECT_URL') || process.env.DATABASE_URL || env('DATABASE_URL');

if (!url) {
  console.error(`
  DIRECT_URL is not set.

  Supabase dashboard → Project Settings → Database → Connection string
    · "Direct connection"  (port 5432)  → DIRECT_URL
    · "Transaction pooler" (port 6543)  → DATABASE_URL

  Put both in .env, then run this again.
`);
  process.exit(1);
}

// The pooler silently fails on DDL in ways that are hard to diagnose, so
// refuse rather than half-apply.
if (url.includes(':6543')) {
  console.error('  DIRECT_URL points at the pooler (port 6543). Migrations need the direct connection (5432).');
  process.exit(1);
}

const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
if (!files.length) {
  console.error(`  No .sql files in ${DIR}`);
  process.exit(1);
}

console.log(`\n  Applying ${files.length} migration(s)\n`);

let client;
try {
  // A large migration can exceed the default statement timeout.
  const conn = await connect(url, { statement_timeout: 300_000 });
  client = conn.client;
  if (conn.note) console.log(`  note: ${conn.note}\n`);
} catch (e) {
  console.error(`  Could not connect: ${e.message}`);
  /**
   * The advice is chosen from the error, not printed unconditionally.
   *
   * This used to say "check the password, and that the project is not paused"
   * for every failure including `EAI_AGAIN` — a name-resolution error, where
   * neither the password nor the project has been reached yet, so both
   * suggestions send the reader to the wrong place. That is how a DNS problem
   * on one machine turns into an afternoon spent rotating credentials.
   */
  if (['EAI_AGAIN', 'ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT'].includes(e.code)) {
    console.error(`
  This is a DNS failure, not an authentication failure — the database was
  never contacted, so the password and the project's state are not implicated.

  Check, in order:
    · that this machine can resolve the host at all:
        node -e "require('dns').lookup('${new URL(url).hostname}',console.log)"
    · whether a public resolver can:
        nslookup ${new URL(url).hostname} 8.8.8.8
      If that answers and your own resolver does not, the fault is your
      resolver or network, not Supabase and not this repository.`);
  } else {
    console.error('  Check the password in DIRECT_URL, and that the project is not paused.');
  }
  process.exit(1);
}

let applied = 0;
for (const f of files) {
  const sql = readFileSync(join(DIR, f), 'utf8');
  process.stdout.write(`  ${f.padEnd(34)}`);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    applied++;
    console.log('ok');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.log('FAILED');
    console.error(`\n  ${e.message}`);
    if (e.position) {
      const upto = sql.slice(0, Number(e.position));
      console.error(`  at line ${upto.split('\n').length} of ${f}`);
      console.error('  ---');
      console.error(sql.split('\n').slice(Math.max(0, upto.split('\n').length - 3),
                                          upto.split('\n').length + 1).join('\n'));
    }
    console.error(`\n  Stopped. ${applied} migration(s) applied; the database is at the last complete one.`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(`\n  All ${applied} applied.\n  Next: npm run db:verify\n`);
