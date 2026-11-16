'use client';
import * as React from 'react';
import {SignRelated} from '@/components/sign/related';
import {Button} from '@/components/ui/button';
import {useAppStore} from '@/store/app-store';
import {getList} from './data';
import {CommercialStatus} from './commercial-controls';
import type {CommercialRecord} from '@/lib/crm/commercial';
export function CommercialRelated({companyId,dealId,contactId}:{companyId?:string;dealId?:string;contactId?:string}){
 const[rows,setRows]=React.useState<CommercialRecord[]>([]),[failure,setFailure]=React.useState(''),[page,setPage]=React.useState(1),[total,setTotal]=React.useState(0);const open=useAppStore(s=>s.openRecord);
 React.useEffect(()=>{const c=new AbortController();void getList<CommercialRecord>(`/api/crm/commercial?${new URLSearchParams({companyId:companyId??'',dealId:dealId??'',contactId:contactId??'',page:String(page)})}`,c.signal).then(r=>{setRows(r.data);setTotal(r.meta.total);setFailure('');}).catch(e=>{if(!c.signal.aborted)setFailure(e.message);});return()=>c.abort();},[companyId,dealId,contactId,page]);
 return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Commercial relationships</h3><Button size="sm" variant="outline" onClick={()=>open('crm',dealId?'commercial-deal':contactId?'commercial-contact':'commercial-company',dealId??contactId??companyId??'')}>Open Commercial Hub</Button></div><p className="text-xs text-slate-500">Authorized offers and agreements. Contact association does not establish signature authority.</p>{failure&&<p role="alert" className="text-xs text-red-700">{failure}</p>}{rows.map(r=><button key={r.id} onClick={()=>open('crm','commercial',r.id)} className="flex w-full items-center justify-between gap-3 border-b py-3 text-left last:border-0"><span className="min-w-0"><strong className="block truncate text-sm font-medium">{r.title}</strong><span className="text-xs text-slate-500">{r.number} · {r.currency} {r.total}</span></span><CommercialStatus status={r.status}/></button>)}{!rows.length&&!failure&&<p className="text-xs text-slate-500">No linked commercial records.</p>}{total>20&&<div className="flex gap-2"><Button size="sm" variant="outline" disabled={page===1} onClick={()=>setPage(x=>x-1)}>Previous</Button><Button size="sm" variant="outline" disabled={page*20>=total} onClick={()=>setPage(x=>x+1)}>Next</Button></div>}<SignRelated recordIds={rows.map(r=>r.id)}/></section>;
}
