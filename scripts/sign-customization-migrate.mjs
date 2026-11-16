import {readFileSync} from 'node:fs';
import {connect,readEnv} from './db-connect.mjs';
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'),{statement_timeout:30000});
try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'");await client.query(readFileSync('supabase/migrations/0130_nextmav_sign_customization_roles.sql','utf8'));if(process.argv.includes('--apply')){await client.query("NOTIFY pgrst,'reload schema'");await client.query('COMMIT');console.log('Applied 0130: existing signing overview includes witness/countersigner roles.');}else{await client.query('ROLLBACK');console.log('0130 validated and rolled back.');}}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
