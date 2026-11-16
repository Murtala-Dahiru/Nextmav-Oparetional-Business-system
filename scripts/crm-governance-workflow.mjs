import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const fixture=JSON.parse(readFileSync(join(tmpdir(),'nextmav-governance-fixture.json'),'utf8'));
const base=process.env.APP_URL || 'http://localhost:3037';
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password})});
assert.equal(login.status,200);
const cookie=login.headers.getSetCookie().map(h=>h.split(';')[0]).join('; ');
async function api(path,body,method=body?'POST':'GET') {
 const r=await fetch(base+path,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const j=await r.json();assert.ok(r.ok,`${path} ${r.status}: ${j.error?.message}`);return j.data;
}
const suffix=randomUUID().slice(0,8);
const {connect,readEnv}=await import('./db-connect.mjs');
const definition=(await api('/api/crm/settings/fields?object=leads')).find(f=>f.key==='property_type');
const workflow={trigger:'lead.created',conditions:{mode:'all',groups:[{mode:'all',rules:[{field:'custom:'+definition.id,operator:'equals',value:'Commercial'}]}]},steps:[{id:randomUUID(),type:'create_task',memberId:'',text:'Custom field acceptance',minutes:1,branch:'always'}]};
const form={name:'Governance condition '+suffix,description:'Synthetic tenant field condition test',definition:workflow};
const draft=await api('/api/crm/automations',{...form,id:null,revision:0,operation:'save'});
const published=await api('/api/crm/automations',{...form,id:draft.id,revision:draft.revision,operation:'publish'});assert.equal(published.status,'published');
await api('/api/crm/leads',{firstName:'Check match '+suffix,customValues:{[definition.id]:'Commercial'}});
await api('/api/crm/leads',{firstName:'Check mismatch '+suffix,customValues:{[definition.id]:'Residential'}});
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'),{statement_timeout:30000});
try{await client.query('select crm_automation_worker(100,$1)',[fixture.orgId]);}finally{await client.end()}
const runs=(await api('/api/crm/automations/runs')).filter(r=>r.automationId===published.id);
assert.ok(runs.some(r=>r.status==='succeeded'));assert.ok(runs.some(r=>r.status==='skipped'));console.log('PASS published automation runs from custom-field event and skips a nonmatching real record');
const {id}=await api('/api/crm/settings/fields',{id:null,version:0,object:'contacts',key:'import_default_'+suffix,label:'Contact allocation',type:'number',required:true,archived:false,options:[],position:1,defaultValue:7});
const importInput={target:'contacts',rows:[['Contact import '+suffix,'12'],['Contact default '+suffix,'']],mapping:{firstName:0,['custom:'+id]:1}};
const preview=await api('/api/crm/import/preview',importInput);assert.ok(preview.rows.every(r=>r.action==='create'));
const result=await api('/api/crm/import/commit',{...importInput,decisions:{}});assert.equal(result.peopleCreated,2);
for(const [label,value] of [['Contact import ',12],['Contact default ',7]]){const row=(await api('/api/crm/contacts?search='+encodeURIComponent(label+suffix)))[0];assert.equal(row.customValues[id],value);}
console.log('PASS contact import maps explicit value and preserves required field default on a blank cell');
