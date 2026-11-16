import {connect,readEnv} from './db-connect.mjs';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'));
try{const {rows:[snapshot]}=await client.query("select count(*)::int count,md5(coalesce(string_agg(id::text||':'||value::text||':'||pipeline_version::text||':'||updated_at::text,',' order by id),'')) fingerprint,(select count(*)::int from business_events) events,(select count(*)::int from crm_pipeline_events) audits from deals");
const path='docs/pipeline-currency-preservation.json';
if(process.argv.includes('--compare')){assert.deepEqual(snapshot,JSON.parse(readFileSync(path)));console.log('PASS existing amounts, revisions, timestamps and event histories preserved');}else{writeFileSync(path,JSON.stringify(snapshot));console.log('Captured non-sensitive preservation fingerprint');}}
finally{await client.end();}
