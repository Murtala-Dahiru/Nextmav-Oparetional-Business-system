import {readFileSync} from 'node:fs';
import {connect,readEnv} from './db-connect.mjs';
const connection=readEnv('DIRECT_URL')||readEnv('DATABASE_URL');
const api=new URL(readEnv('NEXT_PUBLIC_SUPABASE_URL')),db=new URL(connection),ref=api.hostname.split('.')[0];
if(!decodeURIComponent(db.username).endsWith(`.${ref}`)&&db.hostname!==`db.${ref}.supabase.co`)throw Error('Database/application project mismatch');
const {client}=await connect(connection,{statement_timeout:30000});
try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'");
const exists=(await client.query("select to_regclass('public.sign_envelopes') present")).rows[0].present;
if(!exists)await client.query(readFileSync('supabase/migrations/0105_nextmav_sign.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0106_nextmav_sign_events.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0107_nextmav_sign_followups.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0108_nextmav_sign_reminder_integrity.sql','utf8'));
if(!(await client.query("select 1 from pg_trigger where tgname='sign_envelope_guard'")).rowCount)await client.query(readFileSync('supabase/migrations/0109_nextmav_sign_state_integrity.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0110_nextmav_sign_credential_scope.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0111_nextmav_sign_template_versions.sql','utf8'));
if(!(await client.query("select to_regclass('public.sign_access_audit') present")).rows[0].present)await client.query(readFileSync('supabase/migrations/0112_nextmav_sign_access_audit.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0113_nextmav_sign_rpc_permissions.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0114_nextmav_sign_automation_actions.sql','utf8'));
if(!(await client.query("select to_regclass('public.sign_archive_audit') present")).rows[0].present)await client.query(readFileSync('supabase/migrations/0115_nextmav_sign_archive.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0116_nextmav_sign_access_races.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0117_nextmav_sign_credential_issuance.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0118_nextmav_sign_overview.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0119_nextmav_sign_role_checks.sql','utf8'));
await client.query(readFileSync('supabase/migrations/0120_nextmav_sign_standard_defaults.sql','utf8'));
if(process.argv.includes('--apply')){await client.query("NOTIFY pgrst,'reload schema'");await client.query('COMMIT');console.log('NextMav Sign migrations 0105–0120 applied (existing schema preserved).');}
else{await client.query('ROLLBACK');console.log('NextMav Sign migration validated; rolled back.');}
}catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
