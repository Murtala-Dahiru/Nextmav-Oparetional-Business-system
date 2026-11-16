/** Document-specific maintenance; uses the existing database aggregate and
 * Automation Studio event trigger. Invoke from the deployment's job scheduler.
 * No credentials or recipient tokens are printed. */
import type {Envelope} from '../src/lib/sign/model';
import {z} from 'zod';
import {existsSync} from 'node:fs';
if(existsSync('.env'))process.loadEnvFile('.env');
const {supabaseAdmin}=await import('../src/lib/supabase/server');
const {commit,event,finalize}=await import('../src/lib/sign/server');
const args=process.argv.slice(2),org=args[0]?z.uuid().parse(args[0]):undefined;
const db=supabaseAdmin();let finalizing=db.from('sign_envelopes').select('*').eq('status','finalizing').order('updated_at').limit(25);
let expiring=db.from('sign_envelopes').select('*').in('status',['sent','in_progress']).lte('data->>expiresAt',new Date().toISOString()).order('updated_at').limit(25);
if(org){finalizing=finalizing.eq('organization_id',org);expiring=expiring.eq('organization_id',org);}
const queues=await Promise.all([finalizing,expiring]);if(queues.some(r=>r.error))throw Error('Unable to load signing maintenance queue');
const result={data:queues.flatMap(r=>r.data??[])};
let completed=0,expired=0,failed=0;
for(const e of (result.data??[]) as Envelope[]){try{if(e.status==='finalizing'){await finalize(e);completed++;}else if(Date.parse(e.data.expiresAt)<=Date.now()){event(e.data,'agreement.expired','Recipient access expired');await commit(e,'expired');expired++;}}catch{failed++;}}
console.log(JSON.stringify({completed,expired,failed,examined:result.data?.length??0}));
if(failed)process.exitCode=1;
