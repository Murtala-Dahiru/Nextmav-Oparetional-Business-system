/**
 * Print the real columns of the business tables, so a validation schema can be
 * checked against the database rather than against memory.
 *
 *     node scripts/schema-columns.mjs [table ...]
 *
 * Written while auditing the update schemas in `lib/validations`. Eighteen of
 * them had been built with `toUpdateSchema` and imported by no route, so their
 * field names had never once been compared with the columns they were supposed
 * to describe — and several had drifted. `contract:check` compares screens with
 * endpoints; this compares schemas with the schema.
 */
import { connect, readEnv } from './db-connect.mjs';

const DEFAULT_TABLES = [
  'leads', 'contacts', 'companies', 'deals',
  'projects', 'tasks', 'milestones', 'project_members',
  'support_tickets', 'invoices', 'invoice_line_items', 'expenses',
  'products', 'suppliers', 'warehouses', 'stock_movements',
  'calendar_events', 'leave_requests', 'attendance',
  'channels', 'channel_members', 'messages',
  'workspace_pages', 'workspace_files',
  'organizations', 'organization_members', 'profiles', 'departments',
  'notifications', 'todos', 'todo_lists', 'announcements', 'holidays',
];

const tables = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TABLES;

const { client, note } = await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'));
if (note) console.log(`  note: ${note}\n`);

const { rows } = await client.query(
  `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1)
    ORDER BY table_name, ordinal_position`,
  [tables],
);

const byTable = new Map();
for (const r of rows) {
  if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
  byTable.get(r.table_name).push(r);
}

for (const t of tables) {
  const cols = byTable.get(t);
  if (!cols) { console.log(`\n${t}: (no such table)`); continue; }
  console.log(`\n${t}`);
  console.log('  ' + cols.map(c => c.column_name).join(', '));
}

await client.end();
