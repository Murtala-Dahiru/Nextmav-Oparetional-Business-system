import {connect,readEnv} from './db-connect.mjs';
import {writeFileSync} from 'node:fs';
const {client}=await connect(readEnv('DIRECT_URL')||readEnv('DATABASE_URL'));
try{
const views=await client.query("select c.relname name,pg_get_viewdef(c.oid,true) definition from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v'");
const funcs=await client.query("select p.proname name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'");
const selected={views:views.rows.filter(r=>/\bdeals\b/.test(r.definition)),functions:funcs.rows.filter(r=>/\bdeals\b/.test(r.definition)&&(/sum\(|currency|jsonb_build_object/.test(r.definition)))};
writeFileSync('docs/pipeline-currency-schema.json',JSON.stringify(selected,null,2));
console.log(JSON.stringify({views:selected.views.map(r=>r.name),functions:selected.functions.map(r=>r.name)}));
}finally{await client.end();}
