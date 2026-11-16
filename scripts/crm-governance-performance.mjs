import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect, readEnv } from './db-connect.mjs';
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'),{statement_timeout:60000});
try {
 await client.query('BEGIN');
 const org=randomUUID(),field=randomUUID();
 // Rows exist only in a temporary table. Copy the production containment index
 // definition into a representative synthetic distribution without firing CRM events.
 await client.query('CREATE TEMP TABLE governance_perf(organization_id uuid,id bigint,custom_values jsonb) ON COMMIT DROP');
 await client.query(`INSERT INTO governance_perf SELECT $1::uuid,i,jsonb_build_object($2::text,CASE WHEN i%1000=0 THEN 'Industrial' ELSE 'Residential' END) FROM generate_series(1,50000) i`,[org,field]);
 await client.query('CREATE INDEX governance_perf_values ON governance_perf USING gin(custom_values jsonb_path_ops)');
 await client.query('ANALYZE governance_perf');
 const result=await client.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM governance_perf WHERE organization_id=$1 AND custom_values @> $2::jsonb LIMIT 100',[org,{[field]:'Industrial'}]);
 const info=result.rows[0]['QUERY PLAN'][0];assert.equal(info.Plan['Actual Rows'],50);assert.ok(JSON.stringify(info.Plan).includes('governance_perf_values'));
 console.log(`PASS 50,000 synthetic rows, 50 matching records, GIN index selected, ${info['Execution Time']} ms PostgreSQL execution. Temporary-table query excludes network, RLS, application and concurrent writes.`);
} finally {await client.query('ROLLBACK');await client.end();}
