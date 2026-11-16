'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/store/app-store';
import { post, getOne } from './data';
import { personName } from './ui';
import type { Lead } from './types';
import type { ListState } from './use-list';

import { leadViewSchema, type LeadView as Segment } from '@/lib/crm/lead-views';

/** Selection is deliberately limited to the visible page, never hidden records. */
export function LeadInboxTools({ list }: { list: ListState<Lead> }) {
  const user = useAppStore(s => s.user);
  const canAssign = useAppStore(s => s.allows('crm', 'edit')) && ['owner', 'administrator', 'manager'].includes(user?.role ?? '');
  const mayEdit = useAppStore(s => s.allows('crm', 'edit'));
  const [status, setStatus] = React.useState('contacted');
  const storageKey = `crm:lead-segments:${user?.organizationId}:${user?.id}`;
  const [segments, setSegments] = React.useState<Segment[]>([]);
  const [name, setName] = React.useState('');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  // Retain request identities on uncertain failures so retry cannot reassign twice.
  const requests = React.useRef(new Map<string, string>());
  const eligible = list.rows.filter(l => !l.convertedContactId);
  const active = eligible.filter(l => selected.includes(l.id));
  const selectionKey = JSON.stringify([list.page, list.pageSize, list.search, list.filters]);
  React.useEffect(() => { setSelected([]); }, [selectionKey]);
  const [viewVersion, setViewVersion] = React.useState(0);
  const [viewBusy, setViewBusy] = React.useState(true);
  const [viewReady, setViewReady] = React.useState(false);
  const [viewNonce, setViewNonce] = React.useState(0);
  React.useEffect(() => {
    const c = new AbortController(); setViewBusy(true); setViewReady(false);
    getOne<{views: unknown[]; version:number}>('/api/crm/leads/views', c.signal).then(result => {
      if (c.signal.aborted) return;
      let views = result.views;
      if (!result.version) { try { const local = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); if (Array.isArray(local)) views = local; } catch {} }
      setSegments(views.flatMap(v => { const p = leadViewSchema.safeParse(v); return p.success ? [p.data] : []; }).slice(0,20));
      setViewVersion(result.version); setViewReady(true); setError('');
    }).catch(cause => { if (!c.signal.aborted) setError(cause.message); }).finally(() => { if (!c.signal.aborted) setViewBusy(false); });
    return () => c.abort();
  }, [storageKey, viewNonce]);
  async function persist(next: Segment[]) {
    if (!viewReady || viewBusy) return;
    setViewBusy(true); setError('');
    try {
      const r = await fetch('/api/crm/leads/views', { method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:viewVersion,views:next}) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error?.message ?? 'Could not save views');
      setViewVersion(j.data.version); setSegments(next); setMessage('Saved views synced to your membership in this organization.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save views'); }
    finally { setViewBusy(false); }
  }
  async function assign() {
    setBusy(true); setError(''); setMessage('');
    const failures: string[] = [];
    let assigned = 0; let unchanged = 0;
    for (const lead of active.filter(l => !l.ownerId)) {
      const key = requests.current.get(lead.id) ?? crypto.randomUUID();
      requests.current.set(lead.id, key);
      try {
        const result = await post<{ ownerId: string | null; reason: string }>(`/api/crm/leads/${lead.id}/assign`, { requestKey: key, reassign: false });
        if (result.ownerId) assigned++; else unchanged++;
        requests.current.delete(lead.id);
        setSelected(ids => ids.filter(id => id !== lead.id));
      } catch (cause) { failures.push(`${personName(lead)}: ${cause instanceof Error ? cause.message : 'Assignment failed'}`); }
    }
    setMessage(`${assigned} assigned; ${unchanged} without an eligible owner; ${failures.length} failed. Existing ownership is preserved.`);
    setError(failures.join(' · ')); setBusy(false); list.reload();
  }
  async function changeStatus() {
    setBusy(true); setError(''); setMessage('');
    try {
      const results = await post<{id:string;updated:boolean;message?:string}[]>('/api/crm/leads/bulk-status', { status, leads: active.map(l => ({ id: l.id, updatedAt: l.updatedAt })) });
      const updated = results.filter(r => r.updated).map(r => r.id);
      setSelected(ids => ids.filter(id => !updated.includes(id)));
      setMessage(updated.length + ' updated; ' + (results.length - updated.length) + ' failed. Failed leads remain selected.');
      setError(results.filter(r => !r.updated).map(r => (personName(active.find(l => l.id === r.id)!) || 'Lead') + ': ' + r.message).join(' · '));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Status update failed. Reload to check results before retrying.'); }
    finally { setBusy(false); list.reload(); }
  }
  return <div className="space-y-2">
    <details className="rounded-xl border border-border bg-card px-4 py-3">
      <summary className="cursor-pointer text-xs font-medium">Saved lead segments <span className="font-normal text-muted-foreground">· private to you</span></summary>
      <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" disabled={viewBusy} onClick={() => setViewNonce(n => n + 1)}>Reload saved views</Button>
        <Input className="w-52" aria-label="Lead segment name" maxLength={60} placeholder="Name the current filters" value={name} onChange={e => setName(e.target.value)} />
        <Button size="sm" variant="outline" disabled={viewBusy || !viewReady || !name.trim() || (segments.length >= 20 && !segments.some(s => s.name === name.trim()))} onClick={() => { persist([...segments.filter(s => s.name !== name.trim()), leadViewSchema.parse({ name: name.trim(), search: list.search, filters: { ...list.filters }, sort: list.sort, sortDir: list.sortDir })]); setName(''); }}>Save segment</Button>
        {segments.map(s => <span key={s.name} className="inline-flex items-center rounded-md border"><Button size="sm" variant="ghost" onClick={() => { list.setSearch(s.search); if (s.sort && s.sortDir && ['createdAt','updatedAt','lastName','status','score','estimatedValue'].includes(s.sort) && ['asc','desc'].includes(s.sortDir)) list.setSort(s.sort, s.sortDir); for (const key of new Set([...Object.keys(list.filters), ...Object.keys(s.filters)])) list.setFilter(key, s.filters[key] ?? ''); }}>{s.name}</Button><Button size="sm" variant="ghost" disabled={viewBusy || !viewReady} aria-label={`Remove segment ${s.name}`} onClick={() => persist(segments.filter(v => v.name !== s.name))}>×</Button></span>)}
      </div>
    </details>
    {mayEdit && <details className="rounded-xl border border-border bg-card px-4 py-3">
      <summary className="cursor-pointer text-xs font-medium">Bulk actions <span className="font-normal text-muted-foreground">· {eligible.length} on this page</span></summary>
      <fieldset disabled={busy || list.loading} className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">Select leads on this page. Status changes are validated individually; converted leads are excluded. Assignment rules only apply to unassigned selections.</p>
        <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={eligible.length > 0 && active.length === eligible.length} disabled={!eligible.length} onChange={e => setSelected(e.target.checked ? eligible.map(l => l.id) : [])} />Select eligible leads on this page</label><Button size="sm" disabled={!canAssign || !active.some(l => !l.ownerId)} onClick={() => void assign()}>{busy ? 'Assigning…' : `Assign ${active.filter(l => !l.ownerId).length} unassigned`}</Button></div>
        <div className="flex flex-wrap items-center gap-2"><select aria-label="Bulk lead status" className="h-9 rounded-md border bg-background px-2 text-xs" value={status} onChange={e => setStatus(e.target.value)}>{['new','contacted','qualified','proposal','negotiation'].map(v => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}</select><Button size="sm" variant="outline" disabled={!active.length} onClick={() => void changeStatus()}>Set status for {active.length} leads</Button></div>
        <div className="grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">{eligible.map(l => <label key={l.id} className="flex items-center gap-2 rounded-lg border p-2 text-xs"><input type="checkbox" checked={selected.includes(l.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, l.id] : ids.filter(id => id !== l.id))} /><span className="truncate">{personName(l) || l.companyName || 'Unnamed lead'}</span></label>)}</div>
      </fieldset>
    </details>}
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
