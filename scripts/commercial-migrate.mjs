import {readFileSync} from 'node:fs';
import {connect,readEnv} from './db-connect.mjs';
const connection=readEnv('DIRECT_URL')||readEnv('DATABASE_URL');
const api=new URL(readEnv('NEXT_PUBLIC_SUPABASE_URL')),db=new URL(connection),ref=api.hostname.split('.')[0];
if(!decodeURIComponent(db.username).endsWith(`.${ref}`)&&db.hostname!==`db.${ref}.supabase.co`)throw Error('Database/application project mismatch');
const {client}=await connect(connection,{statement_timeout:20000});
try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'");
for(const file of (process.argv.includes('--integrity-only')?['0101_crm_commercial_integrity.sql']:['0098_crm_commercial_foundation.sql','0099_crm_commercial_lifecycle.sql','0100_crm_commercial_overview.sql','0101_crm_commercial_integrity.sql','0102_crm_commercial_automation.sql','0103_crm_commercial_templates.sql','0104_crm_commercial_revision_integrity.sql']))await client.query(readFileSync('supabase/migrations/'+file,'utf8'));
if(process.argv.includes('--apply')){await client.query("NOTIFY pgrst,'reload schema'");await client.query('COMMIT');console.log('Applied commercial migrations 0098–0104');}
else{await client.query('ROLLBACK');console.log('Commercial migrations validated against live schema; rolled back');}
}catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
