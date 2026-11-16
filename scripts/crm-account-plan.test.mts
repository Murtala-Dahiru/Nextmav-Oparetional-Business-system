import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {accountPlanSchema,emptyAccountPlan} from '../src/lib/crm/account-plan';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('account plan validates calendar dates, lengths and versions',()=>{
  assert.ok(accountPlanSchema.safeParse(emptyAccountPlan).success);
  for(const extra of [{version:-1},{reviewDate:'2026-02-30'},{ownerId:'bad'},{risks:'x'.repeat(12001)},{organizationId:id(2)}])
    assert.equal(accountPlanSchema.safeParse({...emptyAccountPlan,...extra}).success,false);
});
test('account plans enforce tenant/role/owner boundaries, revisions and stale-write conflict',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE organization_members(id uuid PRIMARY KEY,organization_id uuid,role text);
      CREATE TABLE companies(id uuid PRIMARY KEY,organization_id uuid,deleted_at timestamptz);
      CREATE FUNCTION auth_member_id(org uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM organization_members WHERE organization_id=org AND id=nullif(current_setting('test.member',true),'')::uuid $$;
      CREATE FUNCTION auth_role_in(org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role FROM organization_members WHERE organization_id=org AND id=auth_member_id(org) $$;
      CREATE FUNCTION can_access_module(org uuid,module text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth_member_id(org) IS NOT NULL $$;
      GRANT SELECT ON companies TO authenticated;
      INSERT INTO organizations VALUES('${id(1)}'),('${id(2)}');
      INSERT INTO organization_members VALUES('${id(10)}','${id(1)}','sales_staff'),('${id(11)}','${id(1)}','support_staff'),('${id(20)}','${id(2)}','owner');
      INSERT INTO companies VALUES('${id(100)}','${id(1)}',NULL),('${id(200)}','${id(2)}',NULL),('${id(101)}','${id(1)}',now());`);
    const sql=readFileSync('supabase/migrations/0052_crm_account_plans.sql','utf8');
    await db.exec(sql); await db.exec(sql);
    await db.exec(`SET ROLE authenticated; SELECT set_config('test.member','${id(10)}',false)`);
    const save=async(version:number,plan:any={},org=id(1),company=id(100))=>(await db.query<any>('SELECT crm_save_account_plan($1,$2,$3,$4) AS plan',[org,company,version,JSON.stringify({...emptyAccountPlan,...plan})])).rows[0].plan;
    const first=await save(0,{objectives:'Retain account',ownerId:id(10)});
    assert.equal(first.version,1);
    await assert.rejects(save(0),/changed/);
    await assert.rejects(save(1,{ownerId:id(20)}),/Owner must belong/);
    await assert.rejects(save(0,{},id(1),id(200)),/Company not found/);
    await assert.rejects(save(0,{},id(2),id(200)),/not permitted/);
    await assert.rejects(save(0,{},id(1),id(101)),/Company not found/);
    await assert.rejects(save(1,{risks:'x'.repeat(12001)}),/check constraint/);
    assert.equal((await save(1,{objectives:'Grow account'})).version,2);
    assert.equal((await db.query('SELECT * FROM crm_account_plan_revisions')).rows.length,2);
    await assert.rejects(db.exec(`UPDATE crm_account_plans SET version=99`),/permission denied/);
    await assert.rejects(db.exec(`DELETE FROM crm_account_plan_revisions`),/permission denied/);
    await db.exec(`SELECT set_config('test.member','${id(11)}',false)`);
    await assert.rejects(save(2),/not permitted/);
    assert.equal((await db.query('SELECT * FROM crm_account_plans')).rows.length,1);
    await db.exec(`SELECT set_config('test.member','${id(20)}',false)`);
    assert.equal((await db.query('SELECT * FROM crm_account_plans')).rows.length,0);
    assert.equal((await db.query('SELECT * FROM crm_account_plan_revisions')).rows.length,0);
  } finally {await db.close();}
});
