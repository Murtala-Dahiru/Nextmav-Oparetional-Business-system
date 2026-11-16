import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {connect,readEnv} from './db-connect.mjs';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env');
const f=JSON.parse(readFileSync(join(tmpdir(),'nextmav-commercial-fixture.json'))),base=process.env.APP_URL||'http://localhost:3012',cookie=f.cookies.map(([k,v])=>`${k}=${v}`).join('; ');
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'),{statement_timeout:20000});const sql=async(q,p=[]) => (await client.query(q,p)).rows;
let passed=0;function check(ok,label){assert.ok(ok,label);console.log('PASS '+label);passed++;}
async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});const j=await r.json();assert.ok(r.ok,`${r.status} ${JSON.stringify(j)}`);return j.data;}
try{
const workflow=await api('/api/crm/automations',{id:null,revision:0,name:'Commercial acceptance follow-up',description:'Isolated durable event check',operation:'publish',definition:{trigger:'commercial.quote_approved',conditions:{mode:'all',groups:[{mode:'all',rules:[{field:'currency',operator:'equals',value:'USD'}]}]},steps:[{id:randomUUID(),type:'create_task',memberId:f.ownerId,text:'Review approved commercial offer',minutes:60,branch:'always'},{id:randomUUID(),type:'notify',memberId:f.ownerId,text:'Commercial approval recorded',minutes:60,branch:'always'}]}});
let r=await api(`/api/crm/commercial/${f.quoteId}`);let result=await api(`/api/crm/commercial/${r.id}`,{revision:r.revision,operation:'revise',note:'Automation acceptance',evidenceId:null});r=await api(`/api/crm/commercial/${result.id}`);
await api(`/api/crm/commercial/${r.id}`,{revision:r.revision,operation:'submit',note:'',evidenceId:null});r=await api(`/api/crm/commercial/${r.id}`);await api(`/api/crm/commercial/${r.id}`,{revision:r.revision,operation:'approve',note:'Reviewed for test',evidenceId:null});
await sql('select crm_automation_worker(100,$1)',[f.orgId]);await sql('select crm_automation_worker(100,$1)',[f.orgId]);
const runs=await sql('select status,id from crm_automation_runs where automation_id=$1',[workflow.id]);check(runs.length===1&&runs[0].status==='succeeded','commercial approval executes through existing durable worker');
const effects=await sql('select action,affected_id from crm_automation_steps where run_id=$1',[runs[0].id]);check(effects.length===2,'commercial workflow creates task and notification');
const task=await sql('select company_id from crm_activities where id=$1',[effects.find(x=>x.action==='create_task').affected_id]);check(task[0].company_id===f.companyId,'automation task links actual customer');
await sql('select crm_automation_worker(100,$1)',[f.orgId]);check((await sql('select count(*)::int n from crm_automation_steps where run_id=$1',[runs[0].id]))[0].n===2,'repeat worker does not duplicate completed commercial effects');
const contract=await api(`/api/crm/commercial/${f.contractId}`);const a=await api('/api/crm/commercial/reminders',{recordId:contract.id,revision:contract.revision,days:[91,61,31]});const b=await api('/api/crm/commercial/reminders',{recordId:contract.id,revision:contract.revision,days:[91,61,31]});check([0,3].includes(a.created)&&b.created===0,'renewal reminder configuration is durable and idempotent');
const reminders=await sql('select a.due_at::date::text due,(r.expires_on-r.days_before)::text expected from crm_commercial_reminders r join crm_activities a on a.id=r.activity_id where r.record_id=$1',[contract.id]);check(reminders.every(x=>x.due===x.expected),'reminder dates match explicit expiration offsets');
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const outsider=await admin.auth.admin.createUser({email:`commercial-outsider-${randomUUID()}@example.com`,password:`Test!${randomUUID()}9a`,email_confirm:true});assert.ifError(outsider.error);
await sql('BEGIN');await sql('SET LOCAL ROLE authenticated');await sql("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:outsider.data.user.id,role:'authenticated'})]);
for(const table of ['crm_commercial_records','crm_commercial_versions','crm_commercial_files','crm_commercial_obligations','crm_commercial_history'])check((await sql(`select count(*)::int n from ${table} where organization_id=$1`,[f.orgId]))[0].n===0,`non-member RLS denies ${table}`);
check((await sql("select count(*)::int n from storage.objects where bucket_id='crm-files' and name like $1",[`${f.orgId}/commercial/%`]))[0].n===0,'private storage denies non-member reads');await sql('ROLLBACK');
await sql('BEGIN');await sql('SET LOCAL ROLE authenticated');await sql("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:f.userId,role:'authenticated'})]);
let denied=false;try{const deleted=await sql("delete from storage.objects where bucket_id='crm-files' and name like $1 returning id",[`${f.orgId}/commercial/%`]);denied=deleted.length===0;}catch(e){denied=e.code==='42501';}check(denied,'even owner cannot delete immutable commercial evidence');await sql('ROLLBACK');
const raw=await sql('select content,currency from crm_commercial_records where id=$1',[f.quoteId]);const inclusive={...raw[0].content,taxInclusive:true,discountPercent:'0',charges:'0',items:[{...raw[0].content.items[0],quantity:'1',unitPrice:'107.50',discountPercent:'0'}]};const p=(await sql('select crm_commercial_price($1,$2,$3) p',[f.orgId,'USD',inclusive]))[0].p;check(p.total==='107.50'&&p.tax==='7.50','inclusive pricing extracts tax without inflating total');
console.log(`${passed} automation and security assertions passed.`);
}finally{await client.end();}
