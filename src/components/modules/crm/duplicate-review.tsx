'use client';
import * as React from 'react';
import {Button} from '@/components/ui/button';
import {useAppStore} from '@/store/app-store';
import {getOne,post} from './data';
import type {Lead} from './types';
import {mergeFields} from '@/lib/crm/merge';
type Candidate={id:string;firstName:string;lastName:string;email:string;companyName:string;confidence:string;reasons:string[]};
const camel=(s:string)=>s.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
export function DuplicateReview({lead,onMerged}:{lead:Lead;onMerged:()=>void}) {
  const mayMerge=useAppStore(s=>s.allows('crm','delete'));
  const [matches,setMatches]=React.useState<Candidate[] | null>(null);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState<string | null>(null);
  const [target,setTarget]=React.useState<Lead | null>(null);
  const [source,setSource]=React.useState<Lead>(lead);
  const [choices,setChoices]=React.useState<Record<string,'source'|'target'>>({});
  const [confirmed,setConfirmed]=React.useState(false);
  const requestKey=React.useRef('');
  async function search() {
    setBusy(true);setError(null);
    try{setMatches(await getOne<Candidate[]>(`/api/crm/leads/${lead.id}/duplicates`));}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function select(id:string) {
    setBusy(true);setError(null);setConfirmed(false);
    try {
      const [freshSource,freshTarget]=await Promise.all([getOne<Lead>(`/api/crm/leads/${lead.id}`),getOne<Lead>(`/api/crm/leads/${id}`)]);
      setSource(freshSource);setTarget(freshTarget);setChoices({});requestKey.current=crypto.randomUUID();
    } catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function merge() {
    if(!target || !confirmed) return;
    setBusy(true);setError(null);
    try {await post(`/api/crm/leads/${source.id}/merge`,{targetId:target.id,sourceUpdated:source.updatedAt,targetUpdated:target.updatedAt,choices,requestKey:requestKey.current});onMerged();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="space-y-3 rounded-lg border border-border p-3">
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">Duplicate review</h3><Button type="button" variant="outline" size="sm" disabled={busy} onClick={search}>{busy?'Checking…':'Check matches'}</Button></div>
    <p className="text-xs text-muted-foreground">Email, phone, company and linked-contact evidence. Possible matches always require human review. Up to 50 candidates.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {matches?.length===0 && <p className="text-sm text-muted-foreground">No matching leads found in your authorized records.</p>}
    {matches && <ul aria-label="Duplicate candidates" className="max-h-80 overflow-y-auto divide-y divide-border pr-1">{matches.map(m=><li key={m.id} className="py-2"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{[m.firstName,m.lastName].filter(Boolean).join(' ') || m.companyName}</p><p className="text-xs text-muted-foreground">{m.email} · {m.confidence==='exact'?'Exact identity evidence':'Possible match'}</p><p className="mt-1 text-xs text-muted-foreground">{m.reasons.join(' · ')}</p></div>{mayMerge && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>select(m.id)}>Review merge</Button>}</div></li>)}</ul>}
    {target && <div className="space-y-3 border-t border-border pt-3"><h4 className="text-sm font-semibold">Keep {target.firstName} {target.lastName}</h4><p className="text-xs text-muted-foreground">This record will be retired into the selected lead. Notes and linked activities are preserved; both original records are retained in the merge audit. Converted leads require customer-level review.</p>
      {mergeFields.map(field=>{const key=camel(field) as keyof Lead;return <fieldset key={field} disabled={busy} className="rounded border border-border p-2"><legend className="px-1 text-xs font-medium">{field.replaceAll('_',' ')}</legend>{(['source','target'] as const).map(side=><label key={side} className="flex items-start gap-2 py-1 text-xs"><input type="radio" name={`merge-${field}`} checked={choices[field]===side} onChange={()=>setChoices(c=>({...c,[field]:side}))}/><span className="break-all">{side==='source'?'This record':'Keep record'}: {typeof (side==='source'?source:target)[key]==='object'?JSON.stringify((side==='source'?source:target)[key]):String((side==='source'?source:target)[key] ?? 'Not recorded')}</span></label>)}</fieldset>;})}
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>I reviewed the identities and field choices and want to merge these leads.</label>
      <div className="flex gap-2"><Button type="button" disabled={busy || !confirmed || mergeFields.some(f=>!choices[f])} onClick={merge}>Merge reviewed records</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>select(target.id)}>Reload both records</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>setTarget(null)}>Cancel</Button></div>
    </div>}
  </section>;
}

