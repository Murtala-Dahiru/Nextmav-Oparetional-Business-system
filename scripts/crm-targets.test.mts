import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('target reporting uses whole target periods, event currency and final deal outcomes without double counting',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`SET timezone='UTC';CREATE ROLE authenticated;
   CREATE FUNCTION can_access_module(org uuid,module text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT org='${id(1)}'::uuid AND current_setting('test.allowed',true)='yes' $$;
   CREATE TABLE performance_targets(id uuid,organization_id uuid,subject_type text,subject_id uuid,metric text,period_label text,period_start date,period_end date,currency text,target_value numeric,superseded_by uuid);
   CREATE TABLE business_events(id bigint,organization_id uuid,subject_member_id uuid,event_type text,entity_id uuid,occurred_at timestamptz,payload jsonb);
   CREATE TABLE crm_activities(organization_id uuid,member_id uuid,created_at timestamptz);
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
   INSERT INTO performance_targets VALUES('${id(100)}','${id(1)}','member','${id(10)}','revenue_won','Q1','2026-01-01','2026-03-31','USD',1000,NULL);
   INSERT INTO business_events VALUES
   (1,'${id(1)}','${id(10)}','deal.won','${id(200)}','2026-01-10','{"value":100,"currency":"USD"}'),
   (2,'${id(1)}','${id(10)}','deal.reopened','${id(200)}','2026-02-01','{}'),
   (3,'${id(1)}','${id(10)}','deal.won','${id(200)}','2026-03-01','{"value":150,"currency":"USD"}'),
   (4,'${id(1)}','${id(10)}','deal.won','${id(201)}','2026-03-01','{"value":900,"currency":"EUR"}'),
   (5,'${id(1)}','${id(10)}','deal.won','${id(202)}','2026-04-01','{"value":900,"currency":"USD"}'),
   (6,'${id(1)}','${id(10)}','deal.won','${id(203)}','2026-03-01','{"value":900,"currency":"USD"}'),
   (7,'${id(1)}','${id(10)}','deal.lost','${id(203)}','2026-03-02','{}');`);
  const sql=readFileSync('supabase/migrations/0063_crm_sales_targets.sql','utf8');await db.exec(sql);await db.exec(sql);
  await db.exec("SET ROLE authenticated;SELECT set_config('test.allowed','yes',false)");
  const run=async(org=1)=>(await db.query<{r:{available:boolean;rows:{actual:number}[]}}>('SELECT crm_sales_targets($1,$2,$3,$4) AS r',[id(org),'2026-02-01','2026-02-28','UTC'])).rows[0].r;
  assert.equal((await run()).rows[0].actual,150,'February selection finds Q1 target, and measures its complete period without double counting reopenings');
  assert.equal((await run(2)).available,false);
  await db.exec("SELECT set_config('test.allowed','no',false)");assert.equal((await run()).available,false);
 } finally {await db.close();}
});
