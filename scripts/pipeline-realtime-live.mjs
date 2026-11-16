import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env');
const fixture=JSON.parse(readFileSync(join(tmpdir(),'nextmav-pipeline-fixture.json')));
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const auth=await client.auth.signInWithPassword({email:fixture.email,password:fixture.password});assert.ifError(auth.error);
let channel;
async function round(label){
 let resolveEvent;const event=new Promise(resolve=>resolveEvent=resolve);
 channel=client.channel(`pipeline-acceptance-${label}-${Date.now()}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'deals',filter:`id=eq.${fixture.dealId}`},payload=>resolveEvent(payload));
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Subscription timed out')),25000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timeout);resolve();}else if(status==='CHANNEL_ERROR'){clearTimeout(timeout);reject(Error('Subscription failed'));}});});
 const current=await client.from('deals').select('pipeline_version').eq('id',fixture.dealId).single();assert.ifError(current.error);
 const value=`Realtime acceptance ${label}`;
 const saved=await client.from('deals').update({next_step:value}).eq('id',fixture.dealId).eq('pipeline_version',current.data.pipeline_version).select('id').single();assert.ifError(saved.error);
 let timeout;const payload=await Promise.race([event,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Realtime event timed out')),25000))]);clearTimeout(timeout);
 assert.equal(payload.new.next_step,value);console.log(`PASS ${label}: authorized deal update received`);
 await client.removeChannel(channel);
}
try{await round('initial subscription');await round('resubscription after disconnect');}finally{await client.removeAllChannels();await client.auth.signOut();}
