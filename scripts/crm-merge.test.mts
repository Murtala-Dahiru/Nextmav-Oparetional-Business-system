import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {citext} from '@electric-sql/pglite/contrib/citext';
import {leadMergeSchema,mergeFields} from '../src/lib/crm/merge';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const choices=Object.fromEntries(mergeFields.map(f=>[f,'target']));
test('merge validation requires each conflict choice, current timestamps and request identity',()=>{
  const payload={targetId:id(1),sourceUpdated:'2026-01-01T00:00:00Z',targetUpdated:'2026-01-01T00:00:00Z',requestKey:id(2),choices};
  assert.ok(leadMergeSchema.safeParse(payload).success);
  for(const extra of [{choices:{}},{requestKey:'bad'},{sourceUpdated:'yesterday'},{organizationId:id(3)}]) assert.equal(leadMergeSchema.safeParse({...payload,...extra}).success,false);
});
test('merge transaction preserves references and notes, audits choices, rejects stale/foreign/converted records and retries safely',async()=>{
  const db=new PGlite({extensions:{citext}});
  try {
    await db.exec(`SET timezone='UTC'; CREATE EXTENSION citext; CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE organization_members(id uuid PRIMARY KEY,organization_id uuid,role text);
      CREATE FUNCTION auth_member_id(org uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM organization_members WHERE organization_id=org AND id=nullif(current_setting('test.member',true),'')::uuid $$;
      CREATE FUNCTION auth_role_in(org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role FROM organization_members WHERE organization_id=org AND id=auth_member_id(org) $$;
      CREATE FUNCTION can_access_module(org uuid,module text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth_member_id(org) IS NOT NULL $$;
      CREATE TYPE lead_status AS ENUM('new','contacted','qualified','proposal','negotiation','won','lost');
      CREATE TYPE deal_stage AS ENUM('prospecting','qualification','proposal','negotiation','closed_won','closed_lost');`);
    const base=readFileSync('supabase/migrations/0003_business_tables.sql','utf8');
    for(const table of ['companies','contacts','leads','deals','crm_activities']) {
      const match=base.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));assert.ok(match);await db.exec(match[0]);
      await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; CREATE POLICY baseline ON ${table} TO authenticated USING(can_access_module(organization_id,'crm')) WITH CHECK(can_access_module(organization_id,'crm')); GRANT ALL ON ${table} TO authenticated;`);
    }
    await db.exec(`CREATE TABLE deal_stage_events(id serial PRIMARY KEY,organization_id uuid,deal_id uuid REFERENCES deals(id));
      CREATE TABLE partner_leads(id uuid PRIMARY KEY,organization_id uuid,lead_id uuid REFERENCES leads(id));`);
    await db.exec(readFileSync('supabase/migrations/0050_crm_conversion_and_access.sql','utf8'));
    const migration=readFileSync('supabase/migrations/0053_crm_lead_merge.sql','utf8');await db.exec(migration);await db.exec(migration);
    await db.exec(readFileSync('supabase/migrations/0055_crm_lead_qualification.sql','utf8'));
    await db.exec(`CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO authenticated;GRANT SELECT,INSERT ON storage.objects TO authenticated;CREATE POLICY baseline ON storage.objects TO authenticated USING(true) WITH CHECK(true);
      CREATE FUNCTION storage_org_id(value text) RETURNS uuid LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN split_part(value,'/',1)::uuid;EXCEPTION WHEN others THEN RETURN NULL;END $$;
      CREATE TABLE crm_capture_submissions(id uuid PRIMARY KEY,organization_id uuid,lead_id uuid REFERENCES leads(id));`);
    await db.exec(readFileSync('supabase/migrations/0061_crm_files.sql','utf8'));
    await db.exec(readFileSync('supabase/migrations/0062_crm_merge_extensions.sql','utf8'));
    await db.exec(`INSERT INTO organizations VALUES('${id(1)}'),('${id(2)}');
      INSERT INTO organization_members VALUES('${id(10)}','${id(1)}','owner'),('${id(11)}','${id(1)}','sales_staff'),('${id(20)}','${id(2)}','owner');
      INSERT INTO leads(id,organization_id,first_name,email,phone,company_name,notes,owner_id,updated_at) VALUES
      ('${id(100)}','${id(1)}','Source',' Ada@Example.test ','+234 800 123 4567','Acme Ltd','Source notes','${id(10)}','2026-01-01'),
      ('${id(101)}','${id(1)}','Target','ada@example.test','2348001234567','Acme Limited','Target notes','${id(10)}','2026-01-01'),
      ('${id(102)}','${id(1)}','Possible',NULL,NULL,'Acme Limited','','${id(11)}','2026-01-01'),
      ('${id(103)}','${id(1)}','Converted',NULL,NULL,'Other','','${id(10)}','2026-01-01'),
      ('${id(200)}','${id(2)}','Foreign','ada@example.test',NULL,'Acme','','${id(20)}','2026-01-01');
      UPDATE leads SET converted_at=now() WHERE id='${id(103)}';
      INSERT INTO crm_activities(organization_id,lead_id,activity_type,subject) VALUES('${id(1)}','${id(100)}','call','Original call');
      INSERT INTO partner_leads VALUES('${id(300)}','${id(1)}','${id(100)}');
      SET ROLE authenticated; SELECT set_config('test.member','${id(10)}',false);`);
    const duplicates=await db.query<any>('SELECT * FROM crm_lead_duplicates($1,$2)',[id(1),id(100)]);
    assert.equal(duplicates.rows.length,2);assert.equal(duplicates.rows[0].confidence,'exact');
    assert.equal(duplicates.rows[1].confidence,'possible');
    const merge=async(target=101,key=500,values=choices,stamp='2026-01-01T00:00:00Z')=>(await db.query<any>('SELECT crm_merge_leads($1,$2,$3,$4,$5,$6,$7) AS result',[id(1),id(100),id(target),stamp,'2026-01-01T00:00:00Z',JSON.stringify(values),id(key)])).rows[0].result;
    await assert.rejects(merge(200),/not found/);
    await assert.rejects(merge(101,500,choices,'2026-01-02T00:00:00Z'),/changed/);
    const convertedStamp=(await db.query<any>('SELECT updated_at::text AS stamp FROM leads WHERE id=$1',[id(103)])).rows[0].stamp;
    await assert.rejects(db.query('SELECT crm_merge_leads($1,$2,$3,$4,$5,$6,$7)',[id(1),id(100),id(103),'2026-01-01T00:00:00Z',convertedStamp,JSON.stringify(choices),id(500)]),/Converted leads/);
    await assert.rejects(merge(101,500,{}),/every merge field/);
    await db.exec(`SELECT set_config('test.member','${id(11)}',false)`);
    await assert.rejects(merge(),/permission/);
    assert.equal((await db.query('SELECT * FROM crm_lead_duplicates($1,$2)',[id(1),id(100)])).rows.length,0);
    await db.exec(`SELECT set_config('test.member','${id(10)}',false)`);
    const path=`${id(1)}/lead/${id(100)}/${id(900)}`;
    await db.query(`INSERT INTO crm_files(id,organization_id,record_kind,record_id,filename,mime_type,size_bytes,storage_path,created_by) VALUES($1,$2,'lead',$3,'Brief.pdf','application/pdf',50,$4,$5)`,[id(900),id(1),id(100),path,id(10)]);
    await db.query(`INSERT INTO storage.objects VALUES('crm-files',$1)`,[path]);
    const merged=await merge();assert.equal(merged.already_merged,false);
    assert.equal((await merge()).already_merged,true);
    await assert.rejects(merge(102),/retry does not match/);
    const row=(await db.query<any>('SELECT * FROM leads WHERE id=$1',[id(101)])).rows[0];
    assert.equal(row.first_name,'Target');assert.equal(row.notes,'Target notes\n\nSource notes');
    assert.equal((await db.query<{record_id:string}>('SELECT record_id FROM crm_files')).rows[0].record_id,id(101));
    assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,1);
    assert.equal((await db.query<any>('SELECT lead_id FROM crm_activities')).rows[0].lead_id,id(101));
    const retired=(await db.query<any>('SELECT * FROM leads WHERE id=$1',[id(100)])).rows[0];
    assert.ok(retired.deleted_at);assert.equal(retired.merged_into_id,id(101));
    await assert.rejects(db.query('UPDATE leads SET deleted_at=NULL WHERE id=$1',[id(100)]),/Invalid merged/);
    await assert.rejects(db.query('UPDATE leads SET merged_into_id=NULL WHERE id=$1',[id(100)]),/audited merge/);
    const audit=(await db.query<any>('SELECT * FROM crm_lead_merges')).rows;
    assert.equal(audit.length,1);assert.equal(audit[0].source_snapshot.first_name,'Source');
    await assert.rejects(db.exec('DELETE FROM crm_lead_merges'),/permission denied/);
    await db.exec(`SELECT set_config('test.member','${id(11)}',false)`);
    assert.equal((await db.query('SELECT * FROM crm_files')).rows.length,0);
    assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
    await db.exec(`RESET ROLE`);
    assert.equal((await db.query<any>('SELECT lead_id FROM partner_leads')).rows[0].lead_id,id(101));
  } finally {await db.close();}
});
