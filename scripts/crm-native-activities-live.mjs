import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const fixture=JSON.parse(readFileSync(process.env.CRM_AUDIT_FIXTURE));
const base=process.env.APP_URL;
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password})});
assert.equal(login.status,200);
const user=(await login.json()).data.user;
assert.equal(user.organizationId,fixture.orgId,'Synthetic organization must match active session');
const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
async function api(path,method='GET',body){
  const r=await fetch(base+path,{method,headers:{cookie,'Content-Type':'application/json'},body:body && JSON.stringify(body)});
  const result=await r.json();
  assert.ok(r.ok,path+' '+r.status+' '+(result.error?.message || ''));
  return result.data;
}
const tag=randomUUID().slice(0,8);
const lead=await api('/api/crm/leads','POST',{firstName:'Retirement check '+tag,companyName:'Acceptance '+tag});
const previousFramework=await api('/api/crm/qualification');
await api('/api/crm/qualification','PUT',{version:previousFramework.version,name:'Acceptance qualification',fields:[{key:'need',label:'Need',type:'text',required:true}]});
const framework=await api('/api/crm/qualification');
await api('/api/crm/leads/'+lead.id+'/qualification','PUT',{version:lead.qualificationVersion??0,frameworkVersion:framework.version,answers:{need:'Account review'},metadata:{territory:'',industry:'',serviceInterest:'',campaign:''}});
const previousAssignment=await api('/api/crm/assignment');
await api('/api/crm/assignment','PUT',{version:previousAssignment.version,fallbackId:user.memberId,rules:[]});
await api('/api/crm/leads/'+lead.id+'/assign','POST',{requestKey:randomUUID(),reassign:false});
const qualified=await api('/api/crm/leads/'+lead.id);
assert.equal(qualified.ownerId,user.memberId);
assert.equal(qualified.qualification.need,'Account review');
console.log('PASS native lead creation, saved qualification and assignment');
const {contact,company,deal}=await api('/api/crm/leads/'+lead.id+'/convert','POST',{createDeal:true,dealName:'Renewal '+tag,dealValue:100});
assert.equal(deal.contactId,contact.id);assert.equal(deal.companyId,company.id);
for(const [object,id] of [['contacts',contact.id],['companies',company.id],['deals',deal.id]])assert.equal((await api('/api/crm/'+object+'/'+id)).id,id);
console.log('PASS converted customer, company and deal are linked and readable');
for(const type of ['call','meeting','note']){
  const a=await api('/api/crm/activities','POST',{activityType:type,subject:'Audit '+type,dealId:deal.id,companyId:company.id,contactId:contact.id});
  assert.ok((await api('/api/crm/activities?dealId='+deal.id)).some(row=>row.id===a.id));
}
const due=new Date(Date.now()+86400000).toISOString();
const task=await api('/api/crm/activities','POST',{activityType:'followup',subject:'Follow-up '+tag,leadId:lead.id,dueAt:due,remindAt:new Date(Date.now()+3600000).toISOString()});
const members=await api('/api/directory?pageSize=200');
const other=members.find(m=>m.memberId!==user.memberId && m.role==='owner');
assert.ok(other,'Fixture needs a second owner for reassignment');
await api('/api/crm/activities/assign','POST',{id:task.id,updatedAt:task.updatedAt,memberId:other.memberId});
const stale=await fetch(base+'/api/crm/activities/assign',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({id:task.id,updatedAt:task.updatedAt,memberId:user.memberId})});
assert.equal(stale.status,409,'Stale reassignment must reject without overwriting the current assignee');
let saved=(await api('/api/crm/activities?leadId='+lead.id)).find(a=>a.id===task.id);
assert.equal(saved.memberId,other.memberId);assert.ok(saved.remindAt);
await api('/api/crm/activities/'+task.id,'PATCH',{completedAt:new Date().toISOString()});
saved=(await api('/api/crm/activities?leadId='+lead.id)).find(a=>a.id===task.id);assert.ok(saved.completedAt);
const timeline=await api('/api/crm/companies/'+company.id+'/timeline');
assert.ok(JSON.stringify(timeline).includes('Audit call'));
console.log('PASS calls, notes, meetings, lead follow-up, reassignment, reminder persistence, completion, deal activity and customer timeline');
