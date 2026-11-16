'use client';
import * as React from 'react';
import {Button} from '@/components/ui/button';
import {useAppStore} from '@/store/app-store';
import {useModuleRealtime} from '@/hooks/use-realtime';
import {getList} from './data';
import {formatRelativeTime} from '@/lib/format';
import {ArrowUpRight, History, Phone, Users, Handshake, Receipt, FolderKanban, LifeBuoy} from 'lucide-react';
import type {ModuleId} from '@/lib/constants';
type Event={responsibleName?:string|null;eventKey:string;module:ModuleId;recordType:string;recordId:string;title:string;occurredAt:string;detail:string;totalCount:number};
export function RelationshipTimeline({companyId}:{companyId:string}){
 return <AccountTimeline key={companyId} companyId={companyId}/>;
}
function AccountTimeline({companyId}:{companyId:string}){
 const [type,setType]=React.useState('');const[from,setFrom]=React.useState('');const[to,setTo]=React.useState('');
 const openRecord=useAppStore(s=>s.openRecord);const[rows,setRows]=React.useState<Event[]>([]);const[page,setPage]=React.useState(1);const[total,setTotal]=React.useState(0);const[error,setError]=React.useState('');const[loading,setLoading]=React.useState(true);const[nonce,setNonce]=React.useState(0);const refresh=React.useCallback(()=>setNonce(n=>n+1),[]);
 React.useEffect(()=>{const c=new AbortController();setLoading(true);getList<Event>(`/api/crm/companies/${companyId}/timeline?page=${page}&type=${type}&from=${from}&to=${to}`,c.signal).then(r=>{if(!c.signal.aborted){setRows(r.data);setTotal(r.meta.total);setError('');}}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[companyId,page,nonce,type,from,to]);
 useModuleRealtime(`crm-timeline-${companyId}`,['crm_activities','deals','leads','projects','invoices','payments','support_tickets','milestones','calendar_events','contacts','deal_stage_events'],refresh);
 return <div className="space-y-4" aria-busy={loading}>
  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">A chronological view of this customer relationship</p><Button type="button" size="sm" variant="ghost" disabled={loading} onClick={refresh}>Refresh history</Button></div>
  <div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-3"><label className="grid gap-1.5 text-[11px] font-medium text-slate-500">Event type<select className="h-9 rounded-md border bg-white px-2 text-xs text-slate-900" value={type} onChange={e=>{setType(e.target.value);setPage(1)}}><option value="">All events</option>{[['activity','Activities'],['contact','Contacts'],['lead','Lead conversions'],['deal-created','New opportunities'],['deal-closed','Won / lost deals'],['stage','Opportunity stages'],['project','Projects'],['milestone','Milestones'],['meeting','Meetings'],['invoice','Invoices'],['payment','Payments'],['ticket','Support opened'],['ticket-resolved','Support resolved']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="grid gap-1.5 text-[11px] font-medium text-slate-500">From (UTC)<input className="h-9 min-w-0 rounded-md border bg-white px-2 text-xs text-slate-900" type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1)}}/></label><label className="grid gap-1.5 text-[11px] font-medium text-slate-500">Through (UTC)<input className="h-9 min-w-0 rounded-md border bg-white px-2 text-xs text-slate-900" type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1)}}/></label></div>
  {error?<p role="alert" className="rounded-lg border border-destructive/30 p-3 text-xs text-destructive">{error}<Button size="sm" variant="ghost" onClick={refresh}>Retry</Button></p>
   :loading?<p role="status" className="rounded-lg border p-5 text-xs text-muted-foreground">Loading relationship history…</p>
   :rows.length===0?<div className="rounded-xl border border-dashed p-6 text-center"><History className="mx-auto mb-2 size-5 text-muted-foreground"/><p className="text-sm font-medium">No relationship events on this page</p><p className="mt-1 text-xs text-muted-foreground">Recorded activity and linked work appear here when you have access.</p></div>
   :<ol className="ml-3 border-l border-border">{rows.map(e=>{const Icon=e.module==='finance'?Receipt:e.module==='projects'?FolderKanban:e.module==='support'?LifeBuoy:e.eventKey.startsWith('activity:')?Phone:e.recordType==='contact'?Users:Handshake;return <li key={e.eventKey} className="relative pb-4 pl-6 last:pb-0">
    <span aria-hidden="true" className="absolute -left-3 top-4 flex size-6 items-center justify-center rounded-full border bg-white text-blue-600"><Icon className="size-3"/></span>
    <div className="rounded-xl border bg-card p-3 sm:p-4">
     <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="rounded-md bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-wide">{e.module === 'crm' ? 'CRM' : e.module} · {e.recordType.replaceAll('_',' ')}</span><time className="text-[11px] text-muted-foreground" dateTime={e.occurredAt} title={e.occurredAt}>{formatRelativeTime(e.occurredAt)}</time></div>
     <button type="button" className="group flex w-full items-start justify-between gap-3 text-left text-sm font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" onClick={()=>openRecord(e.module,e.recordType,e.recordId)}><span className="min-w-0 break-words">{e.title||'Untitled record'}</span><ArrowUpRight className="size-4 shrink-0 text-muted-foreground group-hover:text-primary"/></button>
     {e.responsibleName&&<p className="mt-1 text-[11px] text-slate-500">Recorded by {e.responsibleName}</p>}
     {e.detail&&<p className="mt-1.5 break-words text-xs leading-5 text-muted-foreground">{e.detail}</p>}
    </div>
   </li>})}</ol>}
  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground"><span>{total} events · page {page} of {Math.max(1,Math.ceil(total/30))}</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={loading||page===1} onClick={()=>setPage(p=>p-1)}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={loading||Boolean(error)||page*30>=total} onClick={()=>setPage(p=>p+1)}>Next</Button></div></div>
  <p className="text-[11px] leading-5 text-muted-foreground">Includes authorized CRM, project, invoice, payment and support records. Logged emails are not a connected mailbox. Commercial contracts and renewals are not yet connected to this timeline.</p>
 </div>;
}
