'use client';
import * as React from 'react';
import {Button} from '@/components/ui/button';
import {getList,exact} from './data';
import {Broken,Spinner} from './ui';
import {useAppStore} from '@/store/app-store';
import {useModuleRealtime} from '@/hooks/use-realtime';
import {formatDate} from '@/lib/format';
import type {ModuleId} from '@/lib/constants';
type Kind='contacts'|'deals'|'projects'|'invoices'|'tickets'|'milestones'|'payments';
type Row={id:string;name?:string;firstName?:string;lastName?:string;jobTitle?:string;crmProfile?:{relationshipRole?:string};stage?:string;status?:string;priority?:string;subject?:string;invoiceNumber?:string;value?:number;total?:number;amountPaid?:number;currency?:string;amount?:number;paidAt?:string;dueDate?:string;endDate?:string;projectId?:string;invoiceId?:string;progressPct?:number;owner?:{profiles?:{fullName:string}};project?:{name:string};invoice?:{invoiceNumber:string;currency:string}};
export function RelatedRecords({companyId,kind}:{companyId:string;kind:Kind}) {
 const[rows,setRows]=React.useState<Row[]>([]),[total,setTotal]=React.useState(0),[page,setPage]=React.useState(1),[loading,setLoading]=React.useState(true),[error,setError]=React.useState(''),[nonce,setNonce]=React.useState(0);
 const openRecord=useAppStore(s=>s.openRecord),currency=useAppStore(s=>s.organization?.currency)??'USD';
 const refresh=React.useCallback(()=>setNonce(n=>n+1),[]);
 React.useEffect(()=>{const c=new AbortController();setLoading(true);getList<Row>(`/api/crm/companies/${companyId}/related?kind=${kind}&page=${page}`,c.signal).then(r=>{if(!c.signal.aborted){setRows(r.data);setTotal(r.meta.total);setError('')}}).catch(e=>{if(!c.signal.aborted)setError(e.message)}).finally(()=>{if(!c.signal.aborted)setLoading(false)});return()=>c.abort()},[companyId,kind,page,nonce]);
 useModuleRealtime(`crm-related-${kind}-${companyId}`,[kind==='tickets'?'support_tickets':kind],refresh);
 const sourceModule:ModuleId=['projects','milestones'].includes(kind)?'projects':['invoices','payments'].includes(kind)?'finance':kind==='tickets'?'support':'crm';
 const type=kind==='milestones'?'project':kind==='payments'?'invoice':kind==='invoices'?'invoice':kind.slice(0,-1);
 return <section className="rounded-xl border bg-white p-4"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold capitalize">{kind==='deals'?'Opportunities':kind} <span className="ml-1 font-normal text-muted-foreground">{total}</span></h3><Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>Refresh</Button></div>
 {error?<Broken message={error} onRetry={refresh}/>:loading?<Spinner label="Loading related records"/>:!rows.length?<p className="py-5 text-sm text-muted-foreground">No {kind} linked to this customer.</p>:<div className="divide-y">{rows.map(r=><button key={r.id} onClick={()=>openRecord(sourceModule,type,r.projectId??r.invoiceId??r.id)} className="flex w-full items-start justify-between gap-3 py-3 text-left hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600"><span className="min-w-0"><span className="block break-words text-sm font-medium">{r.name||r.subject||r.invoiceNumber||r.invoice?.invoiceNumber||`${r.firstName??''} ${r.lastName??''}`.trim()}</span><span className="mt-1 block text-xs text-slate-500">{[r.crmProfile?.relationshipRole,r.jobTitle,r.stage?.replaceAll('_',' '),r.status?.replaceAll('_',' '),r.priority,r.owner?.profiles?.fullName,r.project?.name,r.dueDate?`Due ${formatDate(r.dueDate)}`:null,r.paidAt?formatDate(r.paidAt):null].filter(Boolean).join(' · ')}</span></span><span className="shrink-0 text-right text-xs tabular-nums">{r.value!==undefined?exact(r.value,r.currency??currency):r.total!==undefined?<>{exact(r.total,r.currency!)}<span className="mt-1 block text-slate-500">{exact(Math.max(0,r.total-(r.amountPaid??0)),r.currency!)} outstanding</span></>:r.amount!==undefined?exact(r.amount,r.invoice!.currency):r.progressPct!==undefined?`${r.progressPct}%`:'Open →'}</span></button>)}</div>}
 {total>20&&<div className="mt-3 flex items-center justify-between border-t pt-3"><Button size="sm" variant="outline" disabled={loading||page===1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span className="text-xs">Page {page} of {Math.ceil(total/20)}</span><Button size="sm" variant="outline" disabled={loading||page*20>=total} onClick={()=>setPage(p=>p+1)}>Next</Button></div>}
 </section>
}
