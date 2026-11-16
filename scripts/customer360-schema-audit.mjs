import {connect,readEnv} from './db-connect.mjs';
const url=readEnv('DIRECT_URL')||readEnv('DATABASE_URL');
if(!url){console.log('No database connection configured');process.exit(0)}
const {client}=await connect(url,{statement_timeout:10000});
try{await client.query('BEGIN READ ONLY'); console.log(JSON.stringify({host:new URL(url).hostname,tables:(await client.query("select table_name,column_name,data_type from information_schema.columns where table_schema='public' and table_name in ('companies','contacts','crm_account_plans','crm_activities','project_milestones','deal_stage_events') order by table_name,ordinal_position")).rows,functions:(await client.query("select proname,prosecdef from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname in ('crm_account_summary','crm_relationship_timeline','crm_save_account_plan','crm_save_relationship_profile')")).rows},null,2));}finally{await client.query('ROLLBACK');await client.end()}
