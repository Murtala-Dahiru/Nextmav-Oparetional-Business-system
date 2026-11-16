'use client';
import * as React from 'react';
import {getOne} from './data';
import {useModuleRealtime} from '@/hooks/use-realtime';
export function DirectorySummary({kind}:{kind:'company'|'contact'}) {
 const[data,setData]=React.useState<Record<string,number>|null>(null),[error,setError]=React.useState(''),[nonce,setNonce]=React.useState(0);
 const refresh=React.useCallback(()=>setNonce(n=>n+1),[]);
 React.useEffect(()=>{const c=new AbortController();getOne<Record<string,number>>(`/api/crm/relationships/summary?kind=${kind}`,c.signal).then(v=>{setData(v);setError('')}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[kind,nonce]);
 useModuleRealtime(`crm-directory-summary-${kind}`,[kind==='company'?'companies':'contacts','deals'],refresh);
 const fields=kind==='company'?[['total','Customer accounts','All non-deleted companies'],['newRecords','New in 30 days','Created within the last 30 days'],['withOpportunities','With open opportunities','Accounts with at least one visible open deal'],['unassigned','Without owner','No account owner assigned']]:[['total','Relationships','All non-deleted contacts'],['active','Active contacts','Marked active at their company'],['decisionMakers','Buying stakeholders','Explicit decision-maker or economic buyer role'],['unassigned','Without owner','No relationship owner assigned']];
 return error?<p role="status" className="text-xs text-muted-foreground">Summary unavailable. <button className="underline" onClick={refresh}>Retry</button></p>:<div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Relationship summary">{fields.map(([key,label,hint])=><div key={key} className="rounded-xl border border-slate-200 bg-white px-4 py-3" title={hint}><p className="text-[11px] font-medium text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{data?data[key]?.toLocaleString()??'Unavailable':'—'}</p><p className="mt-1 text-[10px] leading-4 text-slate-600">{hint}</p></div>)}</div>
}
