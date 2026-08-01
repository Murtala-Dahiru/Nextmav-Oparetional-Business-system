import { readFileSync, readdirSync } from 'node:fs';
const dir='supabase/migrations';
const files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
const all=files.map(f=>({f,sql:readFileSync(`${dir}/${f}`,'utf8')}));
const joined=all.map(x=>x.sql).join('\n');

// ── inventory of what is DEFINED ──
const tables=new Set([...joined.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m=>m[1]));
const views =new Set([...joined.matchAll(/CREATE OR REPLACE VIEW public\.(\w+)/g)].map(m=>m[1]));
const funcs =new Set([...joined.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map(m=>m[1]));
const enums =new Map();
for(const m of joined.matchAll(/CREATE TYPE (\w+) AS ENUM \(([^)]*)\)/g)){
  enums.set(m[1], new Set([...m[2].matchAll(/'([^']+)'/g)].map(x=>x[1])));
}

console.log(`DEFINED: ${tables.size} tables, ${views.size} views, ${funcs.size} functions, ${enums.size} enums\n`);

let problems=0;
const fail=(msg)=>{problems++;console.log('  ✗ '+msg);};

// ── 1. every table named in a policy exists ──
for(const m of joined.matchAll(/CREATE POLICY \w+ ON (?:public\.)?(\w+)/g)){
  if(!tables.has(m[1])) fail(`policy references undefined table: ${m[1]}`);
}
// tables listed in the RLS-enable / trigger DO blocks
for(const m of joined.matchAll(/FOREACH t IN ARRAY ARRAY\[([\s\S]*?)\]/g)){
  for(const t of [...m[1].matchAll(/'(\w+)'/g)].map(x=>x[1])){
    if(!tables.has(t)) fail(`DO-block references undefined table: ${t}`);
  }
}
// tables in the policy-generator VALUES list
const genBlock=joined.match(/FOR spec IN[\s\S]*?LOOP/);
if(genBlock) for(const m of genBlock[0].matchAll(/\('(\w+)',\s*'(\w+)'\)/g)){
  if(!tables.has(m[1])) fail(`policy generator references undefined table: ${m[1]}`);
}

// ── 2. every public.fn() called is defined ──
// `INSERT INTO public.tbl (cols…)` is a column list, not a function call.
const called=new Set([...joined.matchAll(/(?<!INTO\s)public\.(\w+)\s*\(/g)].map(m=>m[1]));
for(const fn of called){
  if(!funcs.has(fn) && !views.has(fn) && !['storage_org_id'].includes(fn)){
    if(!funcs.has(fn)) fail(`calls undefined function: public.${fn}()`);
  }
}

// ── 3. enum literals cast with ::type are valid members ──
for(const m of joined.matchAll(/'([a-z_]+)'::(\w+)/g)){
  const [,val,typ]=m;
  if(enums.has(typ) && !enums.get(typ).has(val)) fail(`'${val}' is not a member of enum ${typ}`);
}

// ── 4. FK targets exist ──
for(const m of joined.matchAll(/REFERENCES (\w+)\((\w+)\)/g)){
  if(!tables.has(m[1]) && !['users','objects','buckets'].includes(m[1]))
    fail(`FK references undefined table: ${m[1]}`);
}

// ── 5. every view sets security_invoker (tenant-leak guard) ──
for(const m of joined.matchAll(/CREATE OR REPLACE VIEW public\.(\w+)([\s\S]{0,120})/g)){
  if(!/security_invoker\s*=\s*true/.test(m[2])) fail(`view ${m[1]} is MISSING security_invoker=true (would bypass RLS)`);
}

// ── 6. no policy queries organization_members directly (recursion guard) ──
for(const blk of joined.split(/CREATE POLICY /).slice(1)){
  const head=blk.slice(0,160).match(/(\w+) ON (?:public\.)?(\w+)/);
  if(!head) continue;
  const body=blk.split(/;\s*\n/)[0];
  if(head[2]==='organization_members' && /FROM organization_members/.test(body))
    fail(`RECURSION: policy ${head[1]} on organization_members selects from itself`);
}

// ── 7. every business table carries organization_id ──
const exempt=new Set(['profiles','team_members','project_members','task_dependencies',
  'channel_members','message_reactions','invoice_line_items','purchase_order_items',
  'workspace_page_versions','ticket_comments','event_attendees','organizations',
  // A child of `meetings`, exactly as `event_attendees` is a child of
  // `calendar_events`: the tenant comes from the parent, and duplicating it
  // here would be a second answer to "which organisation is this" that can
  // disagree with the first.
  'meeting_participants',
  'document_counters','org_settings','leave_balances','audit_log']);
for(const m of joined.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)){
  const [,name,body]=m;
  if(exempt.has(name)) continue;
  if(!/organization_id\s+uuid\s+NOT NULL/.test(body))
    fail(`table ${name} has no organization_id NOT NULL (cross-tenant leak risk)`);
}

console.log(problems?`\n${problems} PROBLEM(S)`:'\n  ✓ all cross-file checks passed');
