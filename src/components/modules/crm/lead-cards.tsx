'use client';

import { ArrowUpRight, CalendarPlus, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/format';
import { exact } from './data';
import { LeadStatusTag, Monogram, OwnerTag, personName } from './ui';
import type { Lead } from './types';
import type { ListState } from './use-list';
import type { LeadEngagement } from './use-lead-engagement';

/** The same server-paged, authorized collection as the table; no preview-derived totals. */
export function LeadCards({ list, onOpen, onLog, onFollowUp, canCreateActivity, engagement }: {
  list: ListState<Lead>;
  onOpen: (lead: Lead) => void;
  onLog: (lead: Lead) => void;
  onFollowUp: (lead: Lead) => void;
  canCreateActivity: boolean;
  engagement?: Record<string, LeadEngagement>;
}) {
  return <section aria-label="Lead cards" aria-busy={list.loading} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <p role="status">{list.loading ? 'Updating leads…' : `${list.meta.total} matching leads`}</p>
      <label className="flex items-center gap-2">Sort by
        <select aria-label="Sort lead cards" className="h-9 rounded-lg border bg-background px-3 text-foreground" value={`${list.sort}:${list.sortDir}`} onChange={e => {
          const [key, direction] = e.target.value.split(':');
          list.setSort(key, direction as 'asc' | 'desc');
        }}>
          <option value="updatedAt:desc">Recently updated</option>
          <option value="createdAt:desc">Newest leads</option>
          <option value="estimatedValue:desc">Highest estimated value</option>
          <option value="lastName:asc">Name A–Z</option>
          {!['updatedAt:desc','createdAt:desc','estimatedValue:desc','lastName:asc'].includes(`${list.sort}:${list.sortDir}`) && <option value={`${list.sort}:${list.sortDir}`}>Current table sort</option>}
        </select>
      </label>
    </div>
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {list.rows.map(lead => <article key={lead.id} className="group flex min-w-0 flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <Monogram name={personName(lead)} />
          <LeadStatusTag status={lead.status} />
        </div>
        <button className="mt-4 text-left focus-visible:rounded focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onOpen(lead)}>
          <span className="flex items-start justify-between gap-2 text-base font-semibold tracking-tight"><span className="break-words">{personName(lead) || lead.email || 'Unnamed lead'}</span><ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" /></span>
          <span className="mt-1 block text-xs text-muted-foreground">{[lead.jobTitle, lead.companyName].filter(Boolean).join(' · ') || 'Company not recorded'}</span>
        </button>
        <p className="mt-3 truncate text-xs text-muted-foreground" title={lead.email}>{lead.email || lead.phone || 'Contact details not recorded'}</p>
        <div className="my-4 grid grid-cols-2 gap-3 border-y border-border/70 py-3">
          <div><p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Estimated value</p><p className="mt-1 break-words text-sm font-semibold tabular-nums">{lead.estimatedValue ? exact(lead.estimatedValue) : 'Not recorded'}</p></div>
          <div><p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Source</p><p className="mt-1 break-words text-sm">{lead.source || 'Not recorded'}</p>{lead.campaign && <p className="mt-1 truncate text-xs text-muted-foreground" title={lead.campaign}>{lead.campaign}</p>}</div>
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2"><OwnerTag member={lead.owner} /><span className="text-[11px] text-muted-foreground" title={lead.updatedAt}>Updated {formatRelativeTime(lead.updatedAt)}</span></div>
        {engagement?.[lead.id] && <p className={engagement[lead.id].overdueCount ? 'mt-3 text-xs font-medium text-amber-700' : 'mt-3 text-xs text-muted-foreground'}>{engagement[lead.id].nextFollowUpAt ? `${engagement[lead.id].overdueCount ? 'Overdue' : 'Follow-up'} · ${formatRelativeTime(engagement[lead.id].nextFollowUpAt!)}` : 'No next step scheduled'}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!canCreateActivity || list.loading} onClick={() => onFollowUp(lead)}><CalendarPlus className="mr-1.5 size-3.5" />Follow up</Button>
          <Button size="sm" variant="ghost" disabled={!canCreateActivity || list.loading} onClick={() => onLog(lead)}><MessageSquarePlus className="mr-1.5 size-3.5" />Log activity</Button>
        </div>
      </article>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-xs">
      <span className="text-muted-foreground">Page {list.page + 1} of {Math.max(1, Math.ceil(list.meta.total / list.pageSize))}</span>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={list.loading || list.page === 0} onClick={() => list.setPage(list.page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={list.loading || (list.page + 1) * list.pageSize >= list.meta.total} onClick={() => list.setPage(list.page + 1)}>Next</Button></div>
    </div>
  </section>;
}
