import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('account timeline retains actual relationships, module access, owner scope and deterministic pagination',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`CREATE ROLE authenticated;
   CREATE FUNCTION can_access_module(org uuid,module text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT org=nullif(current_setting('test.org',true),'')::uuid AND (module<>'finance' OR current_setting('test.finance',true)='yes') $$;
   CREATE FUNCTION crm_record_visible(org uuid,owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT can_access_module(org,'crm') AND owner=nullif(current_setting('test.owner',true),'')::uuid $$;
   CREATE TABLE companies(id uuid,organization_id uuid,deleted_at timestamptz);
   CREATE TABLE contacts(id uuid,organization_id uuid,company_id uuid,deleted_at timestamptz);
   CREATE TABLE deals(id uuid,organization_id uuid,company_id uuid,owner_id uuid,deleted_at timestamptz,name text,created_at timestamptz,closed_at timestamptz,stage text);
   CREATE TABLE leads(id uuid,organization_id uuid,owner_id uuid,deleted_at timestamptz,converted_contact_id uuid,converted_at timestamptz,first_name text,last_name text);
   CREATE TABLE crm_activities(id uuid,organization_id uuid,company_id uuid,contact_id uuid,deal_id uuid,lead_id uuid,subject text,completed_at timestamptz,created_at timestamptz,activity_type text,due_at timestamptz);
   CREATE TABLE projects(id uuid,organization_id uuid,client_company_id uuid,deleted_at timestamptz,name text,created_at timestamptz,status text);
   CREATE TABLE invoices(id uuid,organization_id uuid,company_id uuid,deleted_at timestamptz,invoice_number text,created_at timestamptz,currency text,total numeric);
   CREATE TABLE payments(id uuid,organization_id uuid,invoice_id uuid,paid_at timestamptz,amount numeric);
   CREATE TABLE support_tickets(id uuid,organization_id uuid,contact_id uuid,deleted_at timestamptz,subject text,created_at timestamptz,resolved_at timestamptz);
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
   INSERT INTO companies VALUES('${id(100)}','${id(1)}',NULL),('${id(200)}','${id(2)}',NULL);
   INSERT INTO contacts VALUES('${id(101)}','${id(1)}','${id(100)}',NULL);
   INSERT INTO deals VALUES('${id(110)}','${id(1)}','${id(100)}','${id(10)}',NULL,'Own deal','2026-01-01',NULL,'proposal'),('${id(111)}','${id(1)}','${id(100)}','${id(11)}',NULL,'Private deal','2026-01-01',NULL,'proposal');
   INSERT INTO crm_activities(id,organization_id,company_id,deal_id,subject,created_at,activity_type) VALUES('${id(120)}','${id(1)}','${id(100)}','${id(111)}','Private commercial terms','2026-01-02','call');
   INSERT INTO invoices VALUES('${id(130)}','${id(1)}','${id(100)}',NULL,'INV-1','2026-01-03','USD',200);
   INSERT INTO payments VALUES('${id(131)}','${id(1)}','${id(130)}','2026-01-04',100);
   INSERT INTO support_tickets VALUES('${id(140)}','${id(1)}','${id(101)}',NULL,'Real support request','2026-01-05',NULL);`);
  const sql=readFileSync('supabase/migrations/0060_crm_relationship_timeline.sql','utf8');await db.exec(sql);await db.exec(sql);
  await db.exec(`SET ROLE authenticated;SELECT set_config('test.org','${id(1)}',false),set_config('test.owner','${id(10)}',false),set_config('test.finance','no',false)`);
  const query=(offset=0,limit=30,org=1,company=100)=>db.query<{event_key:string;total_count:number}>('SELECT * FROM crm_relationship_timeline($1,$2,$3,$4)',[id(org),id(company),offset,limit]);
  const initial=(await query()).rows;
  assert.equal(initial.length,2);assert.ok(initial.every(r=>!r.event_key.includes(id(111))&&!r.event_key.includes(id(120))));
  assert.equal((await query(0,1)).rows[0].event_key,initial[0].event_key);
  assert.equal((await query(1,1)).rows[0].event_key,initial[1].event_key);
  assert.equal((await query(0,30,2,200)).rows.length,0);
  await db.exec("SELECT set_config('test.finance','yes',false)");
  const financial=(await query()).rows;assert.equal(financial.length,4);assert.ok(financial.some(r=>r.event_key===`payment:${id(131)}`));
 } finally {await db.close();}
});
