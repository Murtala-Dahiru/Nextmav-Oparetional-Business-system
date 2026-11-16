import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env');
const fixture=JSON.parse(readFileSync(join(tmpdir(),'nextmav-governance-fixture.json'),'utf8'));
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const email=`governance-readonly-${randomUUID()}@example.invalid`,password=`Test!${randomUUID()}9a`;
const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
const membership=await admin.from('organization_members').insert({organization_id:fixture.orgId,user_id:created.data.user.id,role:'support_staff'});assert.ifError(membership.error);
const base=process.env.APP_URL||'http://localhost:3037';
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);
const cookie=login.headers.getSetCookie().map(h=>h.split(';')[0]).join('; ');
let passed=0;
for(const [path,method,body] of [
 ['/api/export?dataset=leads','GET'],
 ['/api/crm/settings/fields','POST',{}],
 ['/api/crm/settings/layouts','POST',{}],
 ['/api/crm/settings/bulk-fields','POST',{}],
 ['/api/crm/settings/audit','GET'],
]) {
 const response=await fetch(base+path,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 assert.equal(response.status,403,`${path} should reject read-only role`);console.log('PASS Read-only role denied '+path);passed++;
}
const views=await fetch(base+'/api/crm/settings/shared-views',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({object:'leads',name:'Forbidden shared view',scope:'organization',settings:{search:'',sort:'updatedAt',sortDir:'desc',filters:{}}})});
assert.equal(views.status,403);console.log('PASS Read-only role cannot publish organization view');passed++;
console.log(`${passed} authorization API checks passed. Synthetic read-only membership retained; no messages sent.`);
