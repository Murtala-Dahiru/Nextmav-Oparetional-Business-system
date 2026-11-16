'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { getOne } from './data';
import {RelatedRecords} from './related-records';
import { RelationshipTimeline } from './relationship-timeline';

type Context = { company: { name: string }; projects?: { id: string; name: string; status: string }[] };

/** Reuses Account 360's permission-filtered response; no inferred deal/project link. */
export function DealAccountContext({ companyId }: { companyId: string }) {
  const openRecord = useAppStore(s => s.openRecord);
  const maySeeFinance=useAppStore(s=>s.allows('finance','view'));
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<Context | null>(null);
  const [error, setError] = React.useState('');
  const [nonce, setNonce] = React.useState(0);
  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setData(null); setError('');
    getOne<Context>(`/api/crm/companies/${companyId}/overview`, controller.signal).then(result => { if (!controller.signal.aborted) setData(result); }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [companyId, open, nonce]);
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="rounded-xl border bg-card p-4">
    <summary className="cursor-pointer text-sm font-semibold">Customer history and projects</summary>
    {open && <div className="mt-3 space-y-4">
      {error ? <p role="alert" className="text-xs text-destructive">{error}<Button size="sm" variant="ghost" onClick={() => setNonce(n => n + 1)}>Retry</Button></p> : !data ? <p role="status" className="text-xs text-muted-foreground">Loading customer context…</p> : <>
        <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">{data.company.name}</h4><Button size="sm" variant="outline" onClick={() => openRecord('crm', 'company', companyId)}>Open Account 360</Button></div>
        <p className="text-xs text-muted-foreground">Projects belong to this customer; they are not automatically linked to this opportunity.</p>
        {data.projects === undefined ? <p className="text-xs text-muted-foreground">Project information is unavailable with your current permissions.</p> : !data.projects.length ? <p className="text-xs text-muted-foreground">No customer projects recorded.</p> : <ul className="divide-y">{data.projects.map(project => <li key={project.id}><button className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-primary" onClick={() => openRecord('projects', 'project', project.id)}><span>{project.name}</span><span className="text-xs text-muted-foreground">{project.status.replaceAll('_', ' ')} →</span></button></li>)}</ul>}
        {maySeeFinance&&<details className="rounded-lg border p-3"><summary className="cursor-pointer text-xs font-medium">Customer financial records</summary><p className="mt-2 text-xs text-muted-foreground">Customer-level records, not inferred opportunity revenue. Values retain their recorded currencies.</p><RelatedRecords companyId={companyId} kind="invoices"/></details>}
        <RelationshipTimeline companyId={companyId} />
      </>}
    </div>}
  </details>;
}
