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
for(const object of ['contacts','companies','deals']) {
 const key='acceptance_'+suffix;
 const {id}=await api('/api/crm/settings/fields',{id:null,version:0,object,key,label:'Acceptance value',type:'number',required:false,archived:false,options:[],position:1});
 const record=await api('/api/crm/'+object,{...(object==='contacts'?{firstName:'Acceptance'}:{name:'Acceptance '+suffix}),customValues:{[id]:42}});
 const detail=await api(`/api/crm/${object}/${record.id}`);
 assert.equal(detail.customValues[id],42);console.log('PASS '+object+' create and reload typed field');
 const matched=await api('/api/crm/'+object+'?custom='+encodeURIComponent(JSON.stringify({[id]:42})));
 assert.ok(matched.some(r=>r.id===record.id));console.log('PASS '+object+' bounded custom filter');
 const edited=await api(`/api/crm/${object}/${record.id}`,{customValues:{[id]:43},...(object==='deals'?{pipelineVersion:detail.pipelineVersion}:{expectedUpdatedAt:detail.updatedAt})},'PATCH');
 assert.equal(edited.customValues[id],43);console.log('PASS '+object+' guarded edit');
 const latest=await api(`/api/crm/${object}/${record.id}`);
 const bulk=await api('/api/crm/settings/bulk-fields',{object,records:[{id:record.id,updatedAt:latest.updatedAt}],values:{[id]:44}});
 assert.equal(bulk[0].updated,true);
 const stale=await api('/api/crm/settings/bulk-fields',{object,records:[{id:record.id,updatedAt:latest.updatedAt}],values:{[id]:45}});
 assert.equal(stale[0].updated,false);
 assert.equal((await api(`/api/crm/${object}/${record.id}`)).customValues[id],44);
 console.log('PASS '+object+' bulk field update rejects stale retry and preserves value');
}
const definition=(await api('/api/crm/settings/fields?object=leads')).find(f=>f.key==='property_type');
const imported='Import '+suffix;
const body={target:'leads',rows:[[imported,'Residential']],mapping:{firstName:0,['custom:'+definition.id]:1}};
const preview=await api('/api/crm/import/preview',body);assert.equal(preview.rows[0].action,'create');
const invalid=await api('/api/crm/import/preview',{...body,rows:[[imported,'Unknown']]});assert.equal(invalid.rows[0].action,'skip');
const commit=await api('/api/crm/import/commit',{...body,decisions:{}});assert.equal(commit.peopleCreated,1);
const record=(await api('/api/crm/leads?search='+encodeURIComponent(imported)))[0];assert.equal(record.customValues[definition.id],'Residential');
console.log('PASS import previews invalid options and commits mapped values');
const csv=await fetch(base+'/api/export?dataset=leads&ids='+record.id,{headers:{cookie}});assert.equal(csv.status,200);const contents=await csv.text();assert.ok(contents.includes('custom:property_type')&&contents.includes('Residential')&&contents.includes(imported));assert.equal(contents.trim().split('\r\n').length,2);
console.log('PASS selected-record CSV includes custom field and value');
const filteredCsv=await fetch(base+'/api/export?'+new URLSearchParams({dataset:'leads',currentView:'true',search:imported,custom:JSON.stringify({[definition.id]:'Residential'})}),{headers:{cookie}});
assert.equal(filteredCsv.status,200);const filteredText=await filteredCsv.text();assert.ok(filteredText.includes(imported));assert.equal(filteredText.trim().split('\r\n').length,2);console.log('PASS current-view CSV applies search and custom filters together');
const emptyCsv=await fetch(base+'/api/export?'+new URLSearchParams({dataset:'leads',currentView:'true',search:imported,custom:JSON.stringify({[definition.id]:'Commercial'})}),{headers:{cookie}});
assert.equal(emptyCsv.status,200);assert.equal((await emptyCsv.text()).trim().split('\r\n').length,1);console.log('PASS empty current view exports headers only');
const company=(await api('/api/crm/companies?pageSize=1'))[0];assert.ok(company?.id);
for(const path of ['/api/crm/companies/'+company.id+'/overview','/api/crm/commercial','/api/sign']){assert.ok(await api(path));console.log('PASS authenticated module smoke '+path.replace(company.id,'[id]'));}
for (const object of ['companies','deals']) {
 const field=(await api('/api/crm/settings/fields?object='+object)).find(f=>f.key==='acceptance_'+suffix);
 const label='CSV '+object+' '+suffix;
 const body={target:object,mapping:{[object==='companies'?'companyName':'dealName']:0,['custom:'+field.id]:1},rows:[[label,'65']]};
 const preview=await api('/api/crm/import/preview',body);assert.equal(preview.rows[0].action,'create');
 const invalid=await api('/api/crm/import/preview',{...body,rows:[[label,'invalid']]});assert.equal(invalid.rows[0].action,'skip');
 const receipt=await api('/api/crm/import/commit',{...body,decisions:{}});assert.equal(receipt[object==='companies'?'companiesCreated':'dealsCreated'],1);
 const created=(await api('/api/crm/'+object+'?search='+encodeURIComponent(label))).find(r=>r.name===label);assert.equal(created.customValues[field.id],65);
 const duplicate=await api('/api/crm/import/preview',body);assert.notEqual(duplicate.rows[0].action,'create');console.log('PASS '+object+' custom import preview, validation, commit, persistence and duplicate check');
}
