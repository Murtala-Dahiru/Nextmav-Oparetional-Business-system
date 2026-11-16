import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const fixture=JSON.parse(readFileSync(join(tmpdir(),'nextmav-pipeline-fixture.json')));
const base=process.env.APP_URL||'http://localhost:3010';const jar=new Map();let passed=0;
async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});for(const raw of r.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}return {status:r.status,json:await r.json().catch(()=>null)};}
async function good(path,method='GET',body){const r=await call(path,method,body);assert.ok(r.status>=200&&r.status<300,`${path}: ${r.status} ${r.json?.error?.message}`);return r.json.data;}
function check(value,label){assert.ok(value,label);passed++;console.log('PASS '+label);}
await good('/api/auth/login','POST',{email:fixture.email,password:fixture.password});

const before=await good(`/api/crm/deals/${fixture.dealId}`);
const payload={title:'Review acceptance opportunity next action',sourceModule:'crm',sourceType:'deal',sourceId:fixture.dealId,sourceLabel:before.name,dueOn:'2026-12-01'};
const task=await good('/api/todos','POST',payload);
check(task.sourceId===fixture.dealId&&task.sourceType==='deal','personal task links to the actual opportunity');
const repeat=await good('/api/todos','POST',payload);
check(repeat.id===task.id,'repeat intake does not duplicate the opportunity task');
const after=await good(`/api/crm/deals/${fixture.dealId}`);
check(before.pipelineVersion===after.pipelineVersion&&before.stage===after.stage,'personal task intake preserves opportunity stage and revision');
console.log(`${passed} task integration assertions passed.`);
