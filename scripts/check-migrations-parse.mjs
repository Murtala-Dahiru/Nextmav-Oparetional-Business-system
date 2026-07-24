import { readFileSync, readdirSync } from 'node:fs';
const { parse } = await import('pgsql-parser');
const dir='supabase/migrations';
let bad=0;
for (const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()) {
  const sql = readFileSync(`${dir}/${f}`,'utf8');
  try { const o=await parse(sql); const n=Array.isArray(o)?o.length:(o?.stmts?.length??0);
        console.log(`  OK    ${f}  (${n} statements)`); }
  catch(e){ bad++; console.log(`  FAIL  ${f}`); console.log('        '+String(e.message).split('\n')[0]); }
}
process.exit(bad?1:0);
