import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {connect,readEnv} from './db-connect.mjs';
const f=JSON.parse(readFileSync(join(tmpdir(),'nextmav-sign-fixture.json')));
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'),{statement_timeout:20000});
try{await client.query('BEGIN');const q=async(s,p=[])=>(await client.query(s,p)).rows;
const e=(await q("select e.*,m.user_id from sign_envelopes e join organization_members m on m.id=e.owner_id join organizations o on o.id=e.organization_id where e.organization_id=$1 and e.status in ('sent','in_progress') and o.name like 'NextMav Sign acceptance %' and jsonb_array_length(e.data->'recipients')>0 limit 1",[f.orgId]))[0];assert.ok(e,'Synthetic pending agreement required');
await q("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:e.user_id,role:'authenticated'})]);
const r=e.data.recipients[0],hash=createHash('sha256').update(randomBytes(32)).digest('hex'),expires=new Date(Math.min(Date.parse(e.data.expiresAt),Date.now()+60000)).toISOString();
await q('select sign_issue_credential($1,$2,$3,$4,$5,$6,$7,$8,$9)',[hash,e.id,e.revision,r.id,'session',r.generation,expires,true,null]);
await q('select sign_revoke_recipient($1,$2)',[e.id,r.id]);const after=(await q('select revision from sign_envelopes where id=$1',[e.id]))[0];assert.equal(after.revision,e.revision+1);assert.equal((await q('select count(*)::int n from sign_credentials where hash=$1',[hash]))[0].n,0);console.log('PASS access revocation deletes credentials and invalidates loaded signing revisions');
await q('SAVEPOINT issuance');let rejected=false;try{await q('select sign_issue_credential($1,$2,$3,$4,$5,$6,$7,$8,$9)',[hash,e.id,e.revision,r.id,'session',r.generation,expires,true,null]);}catch{rejected=true;await q('ROLLBACK TO SAVEPOINT issuance');}assert.ok(rejected);console.log('PASS credential issuance after concurrent revocation rejects stale revision');
const result=(await q('select sign_commit($1,$2,$3,$4) ok',[e.id,e.revision,'in_progress',e.data]))[0];assert.equal(result.ok,false);console.log('PASS completion begun before access revocation cannot commit afterward');
const allowed=(await q("select has_table_privilege('authenticated','sign_template_versions','UPDATE') allowed"))[0];assert.equal(allowed.allowed,false);console.log('PASS template version snapshots cannot be overwritten by authenticated clients');
await q('ROLLBACK');console.log('4 database hardening assertions passed; synthetic transaction rolled back.');
}finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
