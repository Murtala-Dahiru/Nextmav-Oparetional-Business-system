'use client';
import * as React from 'react';
import {RelatedOrganizations} from './related-organizations';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { useCrmList } from './use-list';
import { getOne } from './data';
import type { Company } from './types';

export function AccountHierarchy({ companyId }: { companyId: string }) {
  const[parent,setParent]=React.useState<{id:string;name:string}|null>(null);
  React.useEffect(()=>{const c=new AbortController();getOne<{parentCompanyId?:string}>(`/api/crm/companies/${companyId}`,c.signal).then(async company=>{if(company.parentCompanyId){const p=await getOne<{id:string;name:string}>(`/api/crm/companies/${company.parentCompanyId}`,c.signal);if(!c.signal.aborted)setParent(p)}}).catch(()=>{});return()=>c.abort()},[companyId]);
  const openRecord = useAppStore(s => s.openRecord);
  const list = useCrmList<Company>('/api/crm/companies', { channel: `crm-subsidiaries-${companyId}`, watch: ['companies'], fixed: { parentCompanyId: companyId }, defaultSort: 'name', defaultSortDir: 'asc' });
  return <><RelatedOrganizations companyId={companyId}/><section className="rounded-xl border bg-card p-4">
    {parent&&<div className="mb-4 border-b pb-3"><p className="text-[11px] text-muted-foreground">Parent account</p><button type="button" className="mt-1 text-sm font-medium text-blue-700 hover:underline" onClick={()=>openRecord('crm','company',parent.id)}>{parent.name} ↗</button></div>}
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Subsidiary accounts</h3><span className="text-xs text-muted-foreground">{list.meta.total}</span></div>
    <p className="mt-1 text-xs text-muted-foreground">Direct subsidiaries linked through the parent account field.</p>
    {list.error ? <div role="alert" className="mt-3 text-xs text-destructive">{list.error}<Button size="sm" variant="ghost" onClick={list.reload}>Retry</Button></div> : list.loading ? <p role="status" className="mt-3 text-xs text-muted-foreground">Loading accounts…</p> : !list.rows.length ? <p className="mt-3 text-xs text-muted-foreground">No subsidiary accounts linked.</p> : <ul className="mt-3 divide-y">{list.rows.map(c => <li key={c.id}><button className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:text-primary" onClick={() => openRecord('crm', 'company', c.id)}><span className="min-w-0 truncate font-medium">{c.name}</span><span className="text-xs text-muted-foreground">{c.industry || 'Open account'} →</span></button></li>)}</ul>}
    {list.meta.total > list.pageSize && <div className="mt-3 flex items-center justify-between"><Button size="sm" variant="outline" disabled={list.page === 0 || list.loading} onClick={() => list.setPage(list.page - 1)}>Previous</Button><span className="text-xs">Page {list.page + 1}</span><Button size="sm" variant="outline" disabled={(list.page + 1) * list.pageSize >= list.meta.total || list.loading} onClick={() => list.setPage(list.page + 1)}>Next</Button></div>}
  </section></>;
}
