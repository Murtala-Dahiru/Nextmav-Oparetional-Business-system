// Run only against an explicitly disposable test project. Creates a dedicated
// organization; uses ordinary cookie-authenticated HTTP for all CRM assertions.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
try { process.loadEnvFile('.env'); } catch {}
if (process.env.CRM_DISPOSABLE_TEST !== 'true') throw new Error('Set CRM_DISPOSABLE_TEST=true only for an authorized disposable test project.');
const base=process.env.APP_URL??'http://localhost:3000';
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const jar=new Map();let userId,orgId,passed=0;
async function call(path,method='GET',body,headers={}){
 const r=await fetch(base+path,{method,redirect:'manual',headers:{'Content-Type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 for(const raw of r.headers.getSetCookie()){const pair=raw.split(';')[0];const i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
 const text=await r.text();let json;try{json=JSON.parse(text);}catch{}
 return {status:r.status,json,headers:r.headers};
}
function check(ok,label){assert.ok(ok,label);passed++;console.log(`PASS ${label}`);}
async function good(path,method='GET',body,headers){const r=await call(path,method,body,headers);assert.ok(r.status>=200&&r.status<300,`${method} ${path}: ${r.status} ${r.json?.error?.message??''}`);return r.json?.data;}
try{
 const email=`crm-foundation-${randomUUID()}@example.com`,password=`V!${randomUUID()}a9`;
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{first_name:'CRM',last_name:'Acceptance'}});
 assert.ifError(created.error);userId=created.data.user.id;
 await good('/api/auth/login','POST',{email,password});
 orgId=(await good('/api/organizations','POST',{name:`CRM acceptance ${Date.now()}`})).id;
 check(Boolean(orgId),'isolated acceptance organization created');
 const membership=await admin.from('organization_members').select('id').eq('organization_id',orgId).eq('user_id',userId).single();assert.ifError(membership.error);const memberId=membership.data.id;
 for(const path of ['insights','targets','pipelines','qualification','assignment','capture']){await good(`/api/crm/${path}`);check(true,`${path} endpoint available after migration`);}
 await good('/api/crm/qualification','PUT',{version:0,name:'Acceptance qualification',fields:[{key:'need',label:'Need',type:'text',required:true}]});
 const framework=await good('/api/crm/qualification');
 const lead=await good('/api/crm/leads','POST',{firstName:'Acceptance',lastName:'Lead',email:`${randomUUID()}@example.com`,source:'website'});
 await good(`/api/crm/leads/${lead.id}/qualification`,'PUT',{version:lead.qualificationVersion??0,frameworkVersion:framework.version,answers:{need:'CRM implementation'},metadata:{territory:'Lagos',industry:'Technology',serviceInterest:'CRM',campaign:'Acceptance'}});
 const qualified=await good(`/api/crm/leads/${lead.id}`);check(qualified.qualification?.need==='CRM implementation','qualification persists through real HTTP and RLS');
 await good('/api/crm/assignment','PUT',{version:0,fallbackId:memberId,rules:[{id:randomUUID(),enabled:true,mode:'round_robin',memberIds:[memberId],matches:[]}]});
 const assignment={requestKey:randomUUID(),reassign:false};await good(`/api/crm/leads/${lead.id}/assign`,'POST',assignment);await good(`/api/crm/leads/${lead.id}/assign`,'POST',assignment);
 check((await good(`/api/crm/leads/${lead.id}`)).ownerId===memberId,'assignment and idempotent retry preserve owner');
 const company=await good('/api/crm/companies','POST',{name:'Acceptance account'});
 const profile=await good(`/api/crm/profiles/company/${company.id}`);
 await good(`/api/crm/profiles/company/${company.id}`,'PUT',{...profile,profile:{tags:['Acceptance'],segment:'Enterprise'},domain:'example.com',teamIds:[memberId],ownerId:memberId});
 check((await good(`/api/crm/profiles/company/${company.id}`)).profile.segment==='Enterprise','account profile saves');
 const plan={version:0,objectives:'Validate CRM',stakeholders:'Owner',opportunities:'Expansion',risks:'None recorded',actions:'Review',ownerId:memberId,reviewDate:'2026-12-01'};
 await good(`/api/crm/companies/${company.id}/plan`,'PUT',plan);check((await good(`/api/crm/companies/${company.id}/plan`)).objectives==='Validate CRM','account plan saves');
 check((await call(`/api/crm/companies/${company.id}/plan`,'PUT',plan)).status===409,'stale account plan rejected');
 await good(`/api/crm/companies/${company.id}/overview`);await good(`/api/crm/companies/${company.id}/timeline`);check(true,'Account 360 overview and timeline resolve');
 const stageA=randomUUID(),stageB=randomUUID();
 const pipeline=await good('/api/crm/pipelines','POST',{id:null,version:0,name:'Acceptance pipeline',purpose:'new_business',stages:[{id:stageA,name:'Discover',canonicalStage:'prospecting',probability:20,inactivityDays:7},{id:stageB,name:'Qualify',canonicalStage:'qualification',probability:50,inactivityDays:7,requiredFields:['next_step']}]});
 const deal=await good('/api/crm/deals','POST',{name:'Acceptance opportunity',value:1500,pipelineId:pipeline.id,pipelineStageId:stageA,companyId:company.id});
 const blocked=await call(`/api/crm/deals/${deal.id}/transition`,'POST',{stageId:stageB,version:deal.pipelineVersion});check(blocked.status>=400&&blocked.status<500,'stage requirements reject missing next step');
 await good(`/api/crm/deals/${deal.id}/execution`,'PUT',{version:deal.pipelineVersion,details:{nextStep:'Arrange discovery',competitor:'',outcomeNotes:'',forecastCategory:'commit',teamIds:[memberId],services:[{name:'CRM service',quantity:1,unitPrice:1500}]}});
 const revised=await good(`/api/crm/deals/${deal.id}`);
 await good(`/api/crm/deals/${deal.id}/transition`,'POST',{stageId:stageB,version:revised.pipelineVersion});
 check((await good(`/api/crm/deals/${deal.id}`)).pipelineStageId===stageB,'configured transition succeeds after required information');
 await good(`/api/crm/pipelines/${pipeline.id}/summary`);check(true,'configured pipeline summary resolves');
 const file=await good(`/api/crm/files?kind=company&id=${company.id}`,'POST','Acceptance attachment',{'Content-Type':'text/plain','X-File-Name':'acceptance.txt'});
 const download=await call(`/api/crm/files/${file.id}`);check([302,303,307].includes(download.status),'private attachment issues signed download');
 await good(`/api/crm/files/${file.id}`,'DELETE');check(true,'attachment upload and deletion work through storage policies');
 const capture=await good('/api/crm/capture','POST',{id:null,version:0,name:'Acceptance capture',fields:[{key:'name',label:'Name',target:'first_name',required:true},{key:'email',label:'Email',target:'email',required:true}],source:'website',campaign:'Acceptance',consentText:'I agree to contact.',enabled:true});
 const form=await good(`/api/crm-capture?form=${capture.id}`);await new Promise(resolve=>setTimeout(resolve,2100));
 const submission={formId:capture.id,challenge:form.challenge,values:{name:'Captured',email:`${randomUUID()}@example.com`},consent:true,website:''};
 await good('/api/crm-capture','POST',submission);await good('/api/crm-capture','POST',submission);
 const leads=await good('/api/crm/leads?search=Captured');check(leads.length===1,'public capture retry creates exactly one lead');check(leads[0].ownerId===memberId,'capture runs configured assignment');
 console.log(`\n${passed} live foundation checks passed.`);
}finally{
 // Only IDs created by this invocation are eligible for fixture cleanup.
 if(orgId){const result=await admin.from('organizations').delete().eq('id',orgId);if(result.error){console.error('Fixture organization cleanup failed:',result.error.code);process.exitCode=1;}}
 if(userId){const result=await admin.auth.admin.deleteUser(userId);if(result.error){console.error('Fixture user cleanup failed:',result.error.code);process.exitCode=1;}}
}
