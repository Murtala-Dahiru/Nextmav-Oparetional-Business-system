import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {citext} from '@electric-sql/pglite/contrib/citext';
import {issueCaptureChallenge,verifyCaptureChallenge} from '../src/lib/crm/capture-challenge';
import {captureFormSchema} from '../src/lib/crm/capture';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('capture challenges bind form, expiry and signature; field maps cannot overwrite destinations',()=>{
 const token=issueCaptureChallenge('test-secret',id(1),3,100000);assert.equal(verifyCaptureChallenge('test-secret',token,id(1),101999),null);assert.ok(verifyCaptureChallenge('test-secret',token,id(1),102000));assert.equal(verifyCaptureChallenge('other',token,id(1),103000),null);assert.equal(verifyCaptureChallenge('test-secret',token,id(2),103000),null);assert.equal(verifyCaptureChallenge('test-secret',token,id(1),1900001),null);assert.equal(verifyCaptureChallenge('test-secret',token+'x',id(1),103000),null);
 assert.equal(captureFormSchema.safeParse({id:null,version:0,name:'Form',source:'site',campaign:'',enabled:true,consentText:'Agree',fields:[{key:'a',label:'Name',target:'first_name',required:true},{key:'b',label:'Name again',target:'first_name',required:false}]}).success,false);
});
test('capture applies durable assignment, preserves duplicate records and consent, limits abuse, and denies direct public writes',async()=>{
 const db=new PGlite({extensions:{citext}});
 try{
  await db.exec(`CREATE EXTENSION citext;CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;
   CREATE TABLE organizations(id uuid PRIMARY KEY);CREATE TABLE organization_members(id uuid PRIMARY KEY,organization_id uuid,role text,is_active boolean DEFAULT true);
   CREATE FUNCTION auth_member_id(org uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM organization_members WHERE organization_id=org AND id=nullif(current_setting('test.member',true),'')::uuid $$;
   CREATE FUNCTION auth_role_in(org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role FROM organization_members WHERE organization_id=org AND id=auth_member_id(org) $$;
   CREATE FUNCTION can_access_module(org uuid,module text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth_member_id(org) IS NOT NULL $$;
   CREATE FUNCTION crm_record_visible(org uuid,owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth_member_id(org) IS NOT NULL AND (auth_role_in(org)<>'sales_staff' OR owner=auth_member_id(org)) $$;
   CREATE TYPE lead_status AS ENUM('new','contacted','qualified','proposal','negotiation','won','lost');`);
  const base=readFileSync('supabase/migrations/0003_business_tables.sql','utf8');
  for(const table of ['companies','contacts','leads']){const match=base.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));assert.ok(match);await db.exec(match[0]);await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; CREATE POLICY baseline ON ${table} TO authenticated USING(can_access_module(organization_id,'crm')) WITH CHECK(can_access_module(organization_id,'crm'));GRANT ALL ON ${table} TO authenticated;`);}
  for(const file of ['0055_crm_lead_qualification.sql','0056_crm_assignment.sql','0057_crm_capture.sql']){const sql=readFileSync(`supabase/migrations/${file}`,'utf8');await db.exec(sql);await db.exec(sql);}
  await db.exec(`INSERT INTO organizations VALUES('${id(1)}'),('${id(2)}');INSERT INTO organization_members(id,organization_id,role) VALUES('${id(10)}','${id(1)}','owner'),('${id(11)}','${id(1)}','sales_staff'),('${id(12)}','${id(1)}','sales_staff'),('${id(20)}','${id(2)}','owner');SET ROLE authenticated;SELECT set_config('test.member','${id(10)}',false);`);
  const rule={id:id(50),enabled:true,mode:'round_robin',memberIds:[id(11),id(12)],matches:[]};
  const settings=(rules:unknown,version=0)=>db.query('SELECT crm_save_assignment_settings($1,$2,$3,$4)',[id(1),version,JSON.stringify(rules),id(10)]);
  await assert.rejects(settings([{...rule,memberIds:[id(20)]}]),/active salesperson/);await settings([rule]);await assert.rejects(settings([rule]),/changed/);
  const config={name:'Enquiry',fields:[{key:'name',label:'Name',target:'first_name',required:true},{key:'email',label:'Email',target:'email',required:true}],source:'website',campaign:'Autumn',consentText:'Please contact me about this enquiry.',enabled:true};
  const form=(await db.query<{id:string}>('SELECT crm_save_capture_form($1,NULL,0,$2) AS id',[id(1),JSON.stringify(config)])).rows[0].id;
  await assert.rejects(db.query('SELECT crm_submit_capture($1,1,$2,$3,true,$4)',[form,id(100),JSON.stringify({name:'Ada',email:'ada@example.test'}),'a'.repeat(64)]),/permission denied/);
  await db.exec('SET ROLE service_role');
  const metadata=(await db.query<{data:Record<string,unknown>}>('SELECT crm_public_capture_form($1) AS data',[form])).rows[0].data;assert.equal(metadata.organizationId,undefined);assert.equal(metadata.fields!==undefined,true);
  const submit=async(n:number,values={name:'Ada',email:'ada@example.test'},version=1,hash='a'.repeat(64))=>(await db.query<{result:string}>('SELECT crm_submit_capture($1,$2,$3,$4,true,$5) AS result',[form,version,id(n),JSON.stringify(values),hash])).rows[0].result;
  assert.equal(await submit(100), 'accepted');assert.equal(await submit(100),'accepted');assert.equal(await submit(100,{name:'Different',email:'different@example.test'}),'invalid');
  assert.equal(await submit(101,{name:'Changed name',email:' ADA@example.test '}),'accepted');
  assert.equal(await submit(102,{name:'Ben',email:'ben@example.test'}),'accepted');
  assert.equal(await submit(103,{name:'Bad',email:'not-an-email'}),'invalid');
  assert.equal(await submit(104,{name:'New',email:'new@example.test'},99),'changed');
  await assert.rejects(db.exec('SELECT * FROM crm_capture_submissions'),/permission denied/);
  await db.exec('RESET ROLE');
  const leads=(await db.query<{id:string;first_name:string;owner_id:string;source:string;campaign:string}>('SELECT id,first_name,owner_id,source,campaign FROM leads ORDER BY first_name')).rows;assert.equal(leads.length,2);assert.equal(leads[0].first_name,'Ada');assert.equal(leads[0].owner_id,id(11));assert.equal(leads[1].owner_id,id(12));assert.equal(leads[0].campaign,'Autumn');
  assert.equal((await db.query('SELECT * FROM crm_capture_submissions')).rows.length,3);assert.equal((await db.query('SELECT * FROM crm_assignment_decisions')).rows.length,2);
  await db.exec(`SET ROLE authenticated;SELECT set_config('test.member','${id(10)}',false)`);
  const assign=async(key:number,reassign=false)=>(await db.query<{r:{reason:string;replayed:boolean}}>('SELECT crm_assign_lead($1,$2,$3,$4) AS r',[id(1),leads[0].id,id(key),reassign])).rows[0].r;
  assert.equal((await assign(300)).reason,'already_owned');assert.equal((await assign(300)).replayed,true);
  await db.exec(`INSERT INTO companies(id,organization_id,name,owner_id) VALUES('${id(600)}','${id(1)}','Known account','${id(12)}');INSERT INTO contacts(id,organization_id,company_id,first_name,email) VALUES('${id(601)}','${id(1)}','${id(600)}','Known contact','ada@example.test');`);
  await settings([{...rule,mode:'account_owner'}],1);
  assert.equal((await assign(303,true)).reason,'account_owner');
  assert.equal((await db.query<{owner_id:string}>('SELECT owner_id FROM leads WHERE id=$1',[leads[0].id])).rows[0].owner_id,id(12));
  await db.exec(`INSERT INTO companies(id,organization_id,name,owner_id) VALUES('${id(602)}','${id(1)}','Ambiguous account','${id(11)}');INSERT INTO contacts(id,organization_id,company_id,first_name,email) VALUES('${id(603)}','${id(1)}','${id(602)}','Ambiguous contact','ada@example.test');`);
  assert.equal((await assign(304,true)).reason,'fallback','Ambiguous account relationships must not choose an arbitrary owner');
  await assert.rejects(db.query('SELECT crm_assign_lead_internal($1,$2,$3,false)',[id(1),leads[0].id,id(301)]),/permission denied/);
  await db.exec(`SELECT set_config('test.member','${id(20)}',false)`);assert.equal((await db.query('SELECT * FROM crm_capture_forms')).rows.length,0);await assert.rejects(assign(302),/not permitted/);
  await db.exec('SET ROLE service_role');
  for(let n=0;n<20;n++)assert.equal(await submit(400+n,{name:'Rate',email:'rate@example.test'},1,'b'.repeat(64)),'accepted');
  assert.equal(await submit(430,{name:'Rate',email:'rate@example.test'},1,'b'.repeat(64)),'limited');
  await db.exec('RESET ROLE');await db.query('UPDATE crm_capture_forms SET enabled=false WHERE id=$1',[form]);await db.exec('SET ROLE service_role');assert.equal(await submit(500),'unavailable');
 }finally{await db.close();}
});
