'use client';
import * as React from 'react';
import { Mail, Phone, Building2, Plus, Pencil, ArrowUpRight } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { useCrmList } from './use-list';
import { getOne, exact } from './data';
import { Broken, Spinner, Monogram, personName, StageTag } from './ui';
import { Panel, Timeline, NextActions } from './record-parts';
import { ContactDialog } from './forms';
import { ActivityDialog } from './activity-dialog';
import { RelationshipProfile } from './relationship-profile';
import { CrmAttachments } from './attachments';
import { RelatedRecords } from './related-records';
import { CommercialRelated } from './commercial-related';
import type { Contact, Deal, CrmActivity } from './types';

export function ContactWorkspace({id,open,onOpenChange,onChanged}:{id:string|null;open:boolean;onOpenChange:(v:boolean)=>void;onChanged:()=>void}) {
 return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full overflow-y-auto p-0 sm:max-w-3xl">{open&&id&&<ContactBody key={id} id={id} onChanged={onChanged} close={()=>onOpenChange(false)}/>}</SheetContent></Sheet>;
}
function ContactBody({id,onChanged,close}:{id:string;onChanged:()=>void;close:()=>void}) {
 const [record,setRecord]=React.useState<Contact|null>(null),[error,setError]=React.useState(''),[nonce,setNonce]=React.useState(0);
 const [tab,setTab]=React.useState('overview'),[edit,setEdit]=React.useState(false),[activity,setActivity]=React.useState<'log'|'followup'|null>(null);
 const mayEdit=useAppStore(s=>s.allows('crm','edit')),mayCreate=useAppStore(s=>s.allows('crm','create'));
 const currency=useAppStore(s=>s.organization?.currency)??'USD';
 const openRecord=useAppStore(s=>s.openRecord);
 const activities=useCrmList<CrmActivity>(`/api/crm/contacts/${id}/activities`,{channel:`crm-contact-activity-${id}`,watch:['crm_activities','contacts'],fixed:{contactId:id}});
 const commitments=useCrmList<CrmActivity>(`/api/crm/contacts/${id}/activities`,{channel:`crm-contact-commitments-${id}`,watch:['crm_activities'],fixed:{contactId:id,due:'open'},defaultSort:'dueAt',defaultSortDir:'asc'});
 const deals=useCrmList<Deal>('/api/crm/deals',{channel:`crm-contact-deals-${id}`,watch:['deals'],fixed:{contactId:id}});
 React.useEffect(()=>{const c=new AbortController();getOne<Contact>(`/api/crm/contacts/${id}`,c.signal).then(v=>{setRecord(v);setError('')}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[id,nonce,activities.rows]);
 const refresh=()=>{setNonce(n=>n+1);activities.reload();commitments.reload();deals.reload();onChanged()};
 const go=(type:string,recordId:string)=>{close();openRecord('crm',type,recordId)};
 const profile=record?.crmProfile;
 return <>
  <SheetHeader className="border-b bg-slate-50/70 p-6 pr-12 text-left"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-700">Relationship workspace</p><div className="mt-3 flex items-center gap-3"><Monogram name={record?personName(record):'Contact'}/><div className="min-w-0"><SheetTitle className="break-words text-2xl tracking-tight">{record?personName(record):'Contact'}</SheetTitle><SheetDescription className="mt-1">{record?[record.jobTitle,profile?.department].filter(Boolean).join(' · ')||'Role not recorded':'Loading relationship details'}</SheetDescription></div></div></SheetHeader>
  {error?<div className="p-6"><Broken message={error} onRetry={()=>setNonce(n=>n+1)}/></div>:!record?<Spinner label="Loading relationship"/>:<>
   <div className="space-y-4 border-b p-5">
    <div className="flex flex-wrap gap-3 text-xs"><span className="rounded-full border bg-slate-50 px-2.5 py-1">{record.isActive?'Active contact':'Moved on'}</span><span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-blue-800">{profile?.relationshipRole||'Relationship role not recorded'}</span>{record.company&&<button className="inline-flex items-center gap-1 font-medium hover:underline" onClick={()=>go('company',record.company!.id)}><Building2 className="size-3.5"/>{record.company.name}<ArrowUpRight className="size-3"/></button>}</div>
    <div className="flex flex-wrap gap-4 text-sm">{record.email&&!profile?.emailOptOut&&<a className="inline-flex min-w-0 items-center gap-2 break-all text-slate-600" href={`mailto:${record.email}`}><Mail className="size-3.5 shrink-0"/>{record.email}</a>}{record.phone&&!profile?.phoneOptOut&&<a className="inline-flex items-center gap-2 text-slate-600" href={`tel:${record.phone}`}><Phone className="size-3.5"/>{record.phone}</a>}</div>
    {(profile?.emailOptOut||profile?.phoneOptOut)&&<p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Recorded opt-out: {[profile.emailOptOut?'email':null,profile.phoneOptOut?'phone':null].filter(Boolean).join(' and ')}. Respect these preferences when planning contact.</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!mayCreate} onClick={()=>setActivity('log')}><Plus className="mr-1 size-3.5"/>Add activity</Button><Button size="sm" variant="outline" disabled={!mayCreate} onClick={()=>setActivity('followup')}>Schedule follow-up</Button><Button size="sm" variant="ghost" disabled={!mayEdit} onClick={()=>setEdit(true)}><Pencil className="mr-1 size-3.5"/>Edit contact</Button></div>
   </div>
   <nav aria-label="Contact workspace" className="flex flex-wrap gap-1 border-b px-5 py-2">{['overview','activity','opportunities','relationship','delivery','documents'].map(t=><button key={t} aria-current={tab===t?'page':undefined} onClick={()=>setTab(t)} className={`rounded-md px-3 py-2 text-xs font-medium capitalize focus-visible:outline-2 focus-visible:outline-blue-600 ${tab===t?'bg-blue-50 text-blue-700':'text-slate-500 hover:bg-slate-50'}`}>{t}</button>)}</nav>
   <div className="space-y-4 bg-slate-50/40 p-5">
    {tab==='overview'&&<><Panel title="Relationship brief"><dl className="grid gap-4 text-xs sm:grid-cols-2">{[['Influence',profile?.influence],['Preferred channel',profile?.preferredMethod],['Consent and preferences',profile?.consent],['Company',record.company?.name],['Account owner',record.owner?.profiles?.fullName]].map(([label,value])=><div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap font-medium text-slate-900">{value||'Not recorded'}</dd></div>)}</dl><p className="mt-4 text-xs leading-6 text-slate-500">{profile?.relationshipNotes||'Add verified relationship context, communication preferences and stakeholder responsibilities in Relationship.'}</p></Panel><Panel title="Upcoming commitments">{commitments.error?<Broken message={commitments.error} onRetry={commitments.reload}/>:commitments.loading?<Spinner label="Loading commitments"/>:<NextActions items={commitments.rows} onChanged={refresh}/>}<Pager page={commitments.page} total={commitments.meta.total} size={commitments.pageSize} change={commitments.setPage}/></Panel>{record.notes&&<Panel title="Notes"><p className="whitespace-pre-wrap text-sm leading-6">{record.notes}</p></Panel>}</>}
    {tab==='activity'&&<Panel title="Activity & relationship history">{activities.error?<Broken message={activities.error} onRetry={activities.reload}/>:activities.loading?<Spinner label="Loading relationship"/>:<Timeline items={activities.rows}/>}<Pager page={activities.page} total={activities.meta.total} size={activities.pageSize} change={activities.setPage}/></Panel>}
    {tab==='opportunities'&&<Panel title="Associated opportunities">{deals.error?<Broken message={deals.error} onRetry={deals.reload}/>:deals.loading?<Spinner label="Loading relationship"/>:deals.rows.length?deals.rows.map(d=><button key={d.id} onClick={()=>go('deal',d.id)} className="flex w-full items-center justify-between gap-3 border-b py-3 text-left text-sm hover:text-blue-700"><span className="min-w-0"><span className="block truncate font-medium">{d.name}</span><StageTag stage={d.stage}/></span><span className="shrink-0 text-xs">{exact(d.value,currency)}</span></button>):<p className="text-sm text-muted-foreground">No opportunities are linked to this contact.</p>}<Pager page={deals.page} total={deals.meta.total} size={deals.pageSize} change={deals.setPage}/></Panel>}
    <div hidden={tab!=='relationship'}><RelationshipProfile kind="contact" id={id} onChanged={refresh}/></div>
    {tab==='delivery'&&(record.companyId?<><p className="text-xs text-muted-foreground">Authorized delivery context for {record.company?.name||'the affiliated company'}. These records belong to the account; individual participation is not inferred.</p><RelatedRecords companyId={record.companyId} kind="projects"/><RelatedRecords companyId={record.companyId} kind="milestones"/></>:<Panel title="Delivery context"><p className="text-sm text-muted-foreground">Associate this contact with a company to view account delivery.</p></Panel>)}
    {tab==='documents'&&<><CrmAttachments kind="contact" id={id}/><CommercialRelated contactId={id}/></>}
   </div>
   <ContactDialog open={edit} onOpenChange={setEdit} editing={record} onSaved={refresh}/>
   {activity&&<ActivityDialog open mode={activity} onOpenChange={v=>{if(!v)setActivity(null)}} link={{kind:'contact',id,label:personName(record),companyId:record.companyId}} onSaved={refresh}/>}
  </>}
 </>;
}
function Pager({page,total,size,change}:{page:number;total:number;size:number;change:(n:number)=>void}) {return total>size?<div className="mt-4 flex items-center justify-between gap-2"><Button size="sm" variant="outline" disabled={!page} onClick={()=>change(page-1)}>Previous</Button><span className="text-xs">{page+1} / {Math.ceil(total/size)}</span><Button size="sm" variant="outline" disabled={(page+1)*size>=total} onClick={()=>change(page+1)}>Next</Button></div>:null}
