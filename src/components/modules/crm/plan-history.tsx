'use client';
import * as React from 'react';
import {getList,getOne} from './data';
import {Button} from '@/components/ui/button';
import {useAppStore} from '@/store/app-store';
import type {PlanItem} from '@/lib/crm/account-plan';
export function LinkedPlanRecord({id,kind}:{id:string;kind:'contact'|'deal'}){
 const[label,setLabel]=React.useState('Loading linked record…'),[ready,setReady]=React.useState(false);const open=useAppStore(s=>s.openRecord);
 React.useEffect(()=>{const c=new AbortController();getOne<{name?:string;firstName?:string;lastName?:string}>(`/api/crm/${kind==='contact'?'contacts':'deals'}/${id}`,c.signal).then(r=>{if(!c.signal.aborted){setLabel(r.name||`${r.firstName??''} ${r.lastName??''}`.trim());setReady(true)}}).catch(()=>{if(!c.signal.aborted){setLabel('Linked record unavailable');setReady(false)}});return()=>c.abort()},[id,kind]);
 return <button type="button" disabled={!ready} className="mt-1 text-left text-xs text-blue-700 hover:underline disabled:text-muted-foreground" onClick={()=>open('crm',kind,id)}>{label}{ready?' ↗':''}</button>
}
export function PlanHistory({companyId,version}:{companyId:string;version:number}) {
 const[rows,setRows]=React.useState<{version:number;changedAt:string;snapshot:{items?:PlanItem[]}}[]>([]),[page,setPage]=React.useState(1),[total,setTotal]=React.useState(0),[error,setError]=React.useState('');
 React.useEffect(()=>{const c=new AbortController();getList<{version:number;changedAt:string;snapshot:{items?:PlanItem[]}}>(`/api/crm/companies/${companyId}/plan/history?page=${page}`,c.signal).then(r=>{if(!c.signal.aborted){setRows(r.data);setTotal(r.meta.total);setError('')}}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[companyId,page,version]);
 return <section className="rounded-xl border bg-white p-4"><h4 className="text-sm font-semibold">Revision & completion history</h4>{error?<p role="alert" className="mt-2 text-xs text-destructive">{error}</p>:!rows.length?<p className="mt-2 text-xs text-muted-foreground">Save a plan to begin its revision history.</p>:rows.map(r=><details key={r.version} className="mt-3 border-t pt-3"><summary className="cursor-pointer text-xs">Revision {r.version} · {new Date(r.changedAt).toLocaleString()}</summary><ul className="mt-2 space-y-2">{r.snapshot.items?.map(i=><li key={i.id} className="text-xs"><span className="font-medium">{i.title}</span> · {i.status.replaceAll('_',' ')} · {i.progress}%{i.dueDate?` · due ${i.dueDate}`:''}</li>)}</ul></details>)}{total>10&&<div className="mt-3 flex gap-2"><Button type="button" size="sm" variant="outline" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous revisions</Button><Button type="button" size="sm" variant="outline" disabled={page*10>=total} onClick={()=>setPage(p=>p+1)}>Older revisions</Button></div>}</section>
}
