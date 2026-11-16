import {readFileSync} from 'node:fs';
import {connect,readEnv} from './db-connect.mjs';
const connection=readEnv('DIRECT_URL')||readEnv('DATABASE_URL');
const api=new URL(readEnv('NEXT_PUBLIC_SUPABASE_URL'));const db=new URL(connection);
const ref=api.hostname.split('.')[0];
if(!decodeURIComponent(db.username).endsWith(`.${ref}`)&&db.hostname!==`db.${ref}.supabase.co`)throw Error('Database and application project identities differ; migration blocked');
console.log(`Verified application/database project: ${ref}; host: ${db.hostname}`);
const {client}=await connect(connection,{statement_timeout:20000});
try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'");for(const file of ['0081_crm_pipeline_workspace.sql','0082_crm_pipeline_lifecycle.sql','0083_crm_opportunity_plans.sql','0084_crm_pipeline_conflicts.sql','0085_crm_deal_qualification_rules.sql','0086_crm_stage_duration_history.sql','0087_crm_pipeline_saved_views.sql','0088_crm_stage_configuration_integrity.sql','0089_crm_pipeline_realtime_indexes.sql','0090_crm_deal_card_facts.sql','0091_crm_approval_revision_decisions.sql','0092_crm_pipeline_evidence_signals.sql','0093_crm_deal_currencies.sql']){await client.query(readFileSync(`supabase/migrations/${file}`,'utf8'));console.log(`Validated ${file}`);}if(process.argv.includes('--apply')){await client.query("NOTIFY pgrst, 'reload schema'");await client.query('COMMIT');console.log('Applied additive pipeline migrations; no fixture records modified.');}else{await client.query('ROLLBACK');console.log('Validation rolled back.');}}catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
