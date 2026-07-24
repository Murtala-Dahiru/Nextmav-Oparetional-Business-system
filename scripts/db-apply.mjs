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
import pg from 'pg';

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

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  // A large migration can exceed the default statement timeout.
  statement_timeout: 300_000,
});

console.log(`\n  Applying ${files.length} migration(s)\n`);

try {
  await client.connect();
} catch (e) {
  console.error(`  Could not connect: ${e.message}`);
  console.error('  Check the password in DIRECT_URL, and that the project is not paused.');
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
