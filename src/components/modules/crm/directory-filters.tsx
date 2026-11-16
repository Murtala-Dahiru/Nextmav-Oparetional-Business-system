'use client';
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LinkPicker, type LinkValue } from './link-picker';
import { getList } from './data';
export const RELATIONSHIP_ROLES = ['Decision-maker','Economic buyer','Technical evaluator','Champion','Influencer','End user','Other'];
export function DirectoryFilters({kind,filters,setFilter}:{kind:'company'|'contact';filters:Record<string,string>;setFilter:(key:string,value:string)=>void}) {
 const [company,setCompany]=React.useState<LinkValue|null>(null);
 const [search,setSearch]=React.useState('');
 const [members,setMembers]=React.useState<{memberId:string;fullName:string}[]>([]);
 const [error,setError]=React.useState('');
 React.useEffect(()=>{const c=new AbortController();const timer=setTimeout(()=>{getList<{memberId:string;fullName:string}>(`/api/directory?search=${encodeURIComponent(search)}`,c.signal).then(r=>{setMembers(r.data);setError('')}).catch(e=>{if(!c.signal.aborted)setError(e.message)});},250);return()=>{c.abort();clearTimeout(timer)}},[search]);
 return <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
  {kind==='contact'&&<label className="grid min-w-40 flex-1 gap-1.5 text-[11px] font-medium text-muted-foreground">Company<LinkPicker kinds={['company']} value={company} onChange={v=>{setCompany(v);setFilter('companyId',v?.id??'')}} placeholder="All companies"/></label>}
  <label className="grid min-w-36 flex-1 gap-1.5 text-[11px] font-medium text-muted-foreground">Find owner<Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search people"/></label>
  <label className="grid min-w-40 flex-1 gap-1.5 text-[11px] font-medium text-muted-foreground">Account owner<select className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={filters.ownerId??''} onChange={e=>setFilter('ownerId',e.target.value)}><option value="">All owners</option>{filters.ownerId&&!members.some(m=>m.memberId===filters.ownerId)&&<option value={filters.ownerId}>Selected owner</option>}{members.map(m=><option key={m.memberId} value={m.memberId}>{m.fullName}</option>)}</select></label>
  {kind==='contact'&&<label className="grid min-w-40 flex-1 gap-1.5 text-[11px] font-medium text-muted-foreground">Relationship role<select className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={filters.relationshipRole??''} onChange={e=>setFilter('relationshipRole',e.target.value)}><option value="">All roles</option>{RELATIONSHIP_ROLES.map(r=><option key={r}>{r}</option>)}</select></label>}
  {Object.values(filters).some(Boolean)&&<Button size="sm" variant="ghost" onClick={()=>{Object.keys(filters).forEach(k=>setFilter(k,''));setCompany(null);setSearch('')}}>Clear filters</Button>}
  {error&&<p role="status" className="w-full text-xs text-destructive">Owner directory unavailable. Search again to retry.</p>}
 </div>
}
