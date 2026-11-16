import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {citext} from '@electric-sql/pglite/contrib/citext';
import {frameworkSchema,defaultFramework,qualificationSchema} from '../src/lib/crm/qualification';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('qualification validates unique stable fields and typed finite answers',()=>{
 assert.ok(frameworkSchema.safeParse(defaultFramework).success);
 assert.equal(frameworkSchema.safeParse({...defaultFramework,fields:[defaultFramework.fields[0],defaultFramework.fields[0]]}).success,false);
 assert.equal(frameworkSchema.safeParse({...defaultFramework,fields:[{...defaultFramework.fields[0],key:'snake_key'}]}).success,false);
 assert.equal(qualificationSchema.safeParse({version:0,frameworkVersion:1,answers:{value:Infinity},metadata:{territory:'',industry:'',serviceInterest:'',campaign:''}}).success,false);
});
test('qualification preserves legacy leads, enforces required answers, versions edits and isolates tenants',async()=>{
 const db=new PGlite({extensions:{citext}});
 try{
  await db.exec(`CREATE EXTENSION citext;CREATE ROLE authenticated;CREATE ROLE anon;
   CREATE TABLE organizations(id uuid PRIMARY KEY);CREATE TABLE organization_members(id uuid PRIMARY KEY,organization_id uuid,role text);
   CREATE FUNCTION auth_member_id(org uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM organization_members WHERE organization_id=org AND id=nullif(current_setting('test.member',true),'')::uuid $$;
   CREATE FUNCTION auth_role_in(org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role FROM organization_members WHERE organization_id=org AND id=auth_member_id(org) $$;
   CREATE FUNCTION can_access_module(org uuid,module text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth_member_id(org) IS NOT NULL $$;
   CREATE FUNCTION crm_record_visible(org uuid,owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth_member_id(org) IS NOT NULL AND (auth_role_in(org)<>'sales_staff' OR owner=auth_member_id(org)) $$;
   CREATE TYPE lead_status AS ENUM('new','contacted','qualified','proposal','negotiation','won','lost');`);
  const base=readFileSync('supabase/migrations/0003_business_tables.sql','utf8');
  for(const table of ['companies','contacts','leads']){const match=base.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));assert.ok(match);await db.exec(match[0]);await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; CREATE POLICY baseline ON ${table} TO authenticated USING(can_access_module(organization_id,'crm')) WITH CHECK(can_access_module(organization_id,'crm'));GRANT ALL ON ${table} TO authenticated;`);}
  const sql=readFileSync('supabase/migrations/0055_crm_lead_qualification.sql','utf8');await db.exec(sql);await db.exec(sql);
  const profiles=readFileSync('supabase/migrations/0058_crm_relationship_profiles.sql','utf8');await db.exec(profiles);await db.exec(profiles);
  await db.exec(`INSERT INTO organizations VALUES('${id(1)}'),('${id(2)}');INSERT INTO organization_members VALUES('${id(10)}','${id(1)}','owner'),('${id(11)}','${id(1)}','sales_staff'),('${id(20)}','${id(2)}','owner');INSERT INTO leads(id,organization_id,first_name,status,owner_id) VALUES('${id(100)}','${id(1)}','Existing','qualified','${id(10)}'),('${id(101)}','${id(1)}','New','new','${id(11)}'); SET ROLE authenticated;SELECT set_config('test.member','${id(10)}',false);`);
  const fields=[{key:'need',label:'Customer need',type:'text',required:true},{key:'budget',label:'Budget',type:'number',required:false}];
  const configure=(version=0)=>db.query('SELECT crm_save_qualification_framework($1,$2,$3,$4)',[id(1),version,'Discovery',JSON.stringify(fields)]);
  await configure();await assert.rejects(configure(),/changed/);
  // A newly configured framework must not break unrelated edits to existing qualified leads.
  await db.exec(`UPDATE leads SET notes='Preserved workflow' WHERE id='${id(100)}'`);
  await assert.rejects(db.exec(`UPDATE leads SET status='qualified' WHERE id='${id(101)}'`),/Customer need/);
  const metadata={territory:'West',industry:'Services',serviceInterest:'Consulting',campaign:'October'};
  const save=(version:number,answers:unknown,framework=1,lead=101)=>db.query('SELECT crm_save_lead_qualification($1,$2,$3,$4,$5,$6)',[id(1),id(lead),version,framework,JSON.stringify(answers),JSON.stringify(metadata)]);
  await assert.rejects(save(0,{need:'Help',budget:'invalid'}),/Budget/);
  await save(0,{need:'Delivery support',budget:10000});
  await assert.rejects(save(0,{need:'Stale'}),/changed/);
  await assert.rejects(save(1,{need:'Changed'},99),/changed/);
  await db.exec(`UPDATE leads SET status='qualified' WHERE id='${id(101)}'`);
  assert.equal((await db.query<{campaign:string}>('SELECT campaign FROM leads WHERE id=$1',[id(101)])).rows[0].campaign,'October');
  assert.equal((await db.query('SELECT * FROM crm_qualification_revisions')).rows.length,1);
  await db.exec(`INSERT INTO companies(id,organization_id,name) VALUES('${id(200)}','${id(1)}','Parent'),('${id(201)}','${id(1)}','Child');`);
  const saveProfile=(record:number,parent:number|null,version=0,team=[id(11)])=>db.query('SELECT crm_save_relationship_profile($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id(1),'company',id(record),version,JSON.stringify({tags:['Strategic'],customFields:[{label:'Region',value:'West'}]}),parent?id(parent):null,team,'example.test',id(10)]);
  await saveProfile(201,200);await assert.rejects(saveProfile(201,200),/changed/);await assert.rejects(saveProfile(200,201),/cycle/);await assert.rejects(saveProfile(200,null,0,[id(20)]),/another organization/);
  assert.equal((await db.query<{parent_company_id:string}>('SELECT parent_company_id FROM companies WHERE id=$1',[id(201)])).rows[0].parent_company_id,id(200));
  await assert.rejects(db.exec('DELETE FROM crm_qualification_revisions'),/permission denied/);
  await db.exec(`SELECT set_config('test.member','${id(11)}',false)`);await assert.rejects(configure(1),/not permitted/);await assert.rejects(save(0,{need:'Other'},1,100),/not found/);
  await db.exec(`SELECT set_config('test.member','${id(20)}',false)`);assert.equal((await db.query('SELECT * FROM crm_qualification_frameworks')).rows.length,0);assert.equal((await db.query('SELECT * FROM crm_qualification_revisions')).rows.length,0);await assert.rejects(save(1,{need:'Foreign'}),/not permitted/);
 }finally{await db.close();}
});
