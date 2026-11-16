// Compare deployed CRM functions with the complete local migration sequence.
// All DDL is inside a transaction that is ALWAYS rolled back, including errors.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { connect, readEnv } from './db-connect.mjs';

const { client } = await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'), { statement_timeout: 15000 });
const catalog = `SELECT p.oid::regprocedure::text AS name, pg_get_functiondef(p.oid) AS definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'crm_%' ORDER BY 1`;
const fingerprint = text => createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='2s'");
  const before = new Map((await client.query(catalog)).rows.map(r => [r.name, fingerprint(r.definition)]));
  const files = readdirSync('supabase/migrations').filter(f => /^00(5\d|6[0-6])_.*\.sql$/.test(f)).sort();
  for (const file of files) await client.query(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  const after = (await client.query(catalog)).rows;
  const result = after.map(r => ({ function: r.name, status: !before.has(r.name) ? 'MISSING' : before.get(r.name) === fingerprint(r.definition) ? 'MATCH' : 'DIFFERS' }));
  console.log(JSON.stringify({ checkedMigrations: files, functions: result }, null, 2));
} finally {
  await client.query('ROLLBACK');
  await client.end();
  console.log('Audit rolled back. No schema or business data committed.');
}
