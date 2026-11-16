'use client';
import * as React from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {LinkPicker,type LinkValue} from './link-picker';
import {getList,post} from './data';
import {Broken,Spinner} from './ui';
import {useAppStore} from '@/store/app-store';
import {useModuleRealtime} from '@/hooks/use-realtime';
type Peer={id:string;name:string;deletedAt:string|null};
type Relation={id:string;relationshipType:string;company:Peer;related:Peer};
export function RelatedOrganizations({companyId}:{companyId:string}){
 const [rows,setRows]=React.useState<Relation[]>([]),[total,setTotal]=React.useState(0),[page,setPage]=React.useState(1),[nonce,setNonce]=React.useState(0),[loading,setLoading]=React.useState(true),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const [selected,setSelected]=React.useState<LinkValue|null>(null),[type,setType]=React.useState('Partner'),[removing,setRemoving]=React.useState<string|null>(null);
 const mayEdit=useAppStore(s=>s.allows('crm','edit')),openRecord=useAppStore(s=>s.openRecord);
 const url=`/api/crm/companies/${companyId}/relationships`;
 useModuleRealtime(`crm-peer-accounts-${companyId}`,['crm_company_relationships','companies'],()=>setNonce(n=>n+1));
 React.useEffect(()=>{const c=new AbortController();setLoading(true);getList<Relation>(`${url}?page=${page}`,c.signal).then(r=>{if(!c.signal.aborted){setRows(r.data);setTotal(r.meta.total);setError('')}}).catch(e=>{if(!c.signal.aborted)setError(e.message)}).finally(()=>{if(!c.signal.aborted)setLoading(false)});return()=>c.abort()},[url,page,nonce]);
 async function save(){if(!selected)return;setBusy(true);setError('');try{await post(url,{companyId:selected.id,type});setSelected(null);setNonce(n=>n+1)}catch(e){setError(e instanceof Error?e.message:'Could not link account')}finally{setBusy(false)}}
 async function remove(id:string){setBusy(true);try{const r=await fetch(`${url}?link=${id}`,{method:'DELETE'});if(!r.ok){const j=await r.json();throw Error(j.error?.message||'Could not remove relationship')}setRemoving(null);setNonce(n=>n+1)}catch(e){setError(e instanceof Error?e.message:'Could not remove relationship')}finally{setBusy(false)}}
 return <section className="space-y-3 rounded-xl border bg-white p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Related organizations</h3><Button size="sm" variant="ghost" onClick={()=>setNonce(n=>n+1)}>Refresh</Button></div><p className="text-xs leading-5 text-muted-foreground">Explicit peer relationships, such as partners, affiliates and joint ventures. Parent accounts and subsidiaries remain in the hierarchy.</p>
 {error&&<Broken message={error} onRetry={()=>setNonce(n=>n+1)}/>}{loading?<Spinner label="Loading related organizations"/>:rows.length?<ul className="divide-y">{rows.map(r=>{const peer=r.company.id===companyId?r.related:r.company;return <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><button disabled={Boolean(peer.deletedAt)} className="text-left text-sm font-medium text-blue-700 hover:underline disabled:text-slate-400" onClick={()=>openRecord('crm','company',peer.id)}>{peer.deletedAt?'Archived account':peer.name}<span className="mt-1 block text-xs font-normal text-slate-500">{r.relationshipType}</span></button>{mayEdit&&(removing===r.id?<span className="flex items-center gap-2 text-xs">Remove link?<Button size="sm" variant="destructive" disabled={busy} onClick={()=>remove(r.id)}>Remove</Button><Button size="sm" variant="ghost" onClick={()=>setRemoving(null)}>Cancel</Button></span>:<Button size="sm" variant="ghost" onClick={()=>setRemoving(r.id)}>Unlink</Button>)}</li>})}</ul>:<p className="py-3 text-xs text-muted-foreground">No peer organizations linked.</p>}
 {total>20&&<div className="flex justify-between"><Button size="sm" variant="outline" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span className="text-xs">{page} / {Math.ceil(total/20)}</span><Button size="sm" variant="outline" disabled={page*20>=total} onClick={()=>setPage(p=>p+1)}>Next</Button></div>}
 {mayEdit&&<fieldset disabled={busy} className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto]"><label className="grid gap-1 text-xs">Organization<LinkPicker kinds={['company']} value={selected} onChange={setSelected}/></label><label className="grid gap-1 text-xs">Relationship type<Input maxLength={80} value={type} onChange={e=>setType(e.target.value)} list="organization-relationship-types"/><datalist id="organization-relationship-types"><option>Partner</option><option>Affiliate</option><option>Joint venture</option><option>Related organization</option></datalist></label><Button className="self-end" size="sm" disabled={busy||!selected||selected.id===companyId||!type.trim()} onClick={save}>{busy?'Saving…':'Link account'}</Button></fieldset>}
 </section>;
}
