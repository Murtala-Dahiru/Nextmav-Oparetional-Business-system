import {connect,readEnv} from './db-connect.mjs';
const url=readEnv('DIRECT_URL')||readEnv('DATABASE_URL');
if(!url){console.log('BLOCKED: no configured database');process.exit(0);}
const {client}=await connect(url,{statement_timeout:10000});
try{
 await client.query('BEGIN READ ONLY');
 console.log(JSON.stringify({host:new URL(url).hostname,
 columns:(await client.query("select table_name,column_name from information_schema.columns where table_schema='public' and table_name in ('deals','crm_pipelines','crm_pipeline_events') order by table_name,ordinal_position")).rows,
 functions:(await client.query("select proname,prosecdef from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname in ('crm_move_deal','crm_save_pipeline','crm_pipeline_forecast','crm_request_stage_approval','crm_decide_stage_approval')")).rows},null,2));
}finally{await client.query('ROLLBACK');await client.end();}
