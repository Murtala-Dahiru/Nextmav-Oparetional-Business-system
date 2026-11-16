'use client';
import * as React from 'react';
import { Target, UserPlus, UserRound, CheckCheck, Clock, CalendarClock } from 'lucide-react';
import { useModuleRealtime } from '@/hooks/use-realtime';
import { getOne } from './data';

type Summary = { active: number; recent: number; unassigned: number; qualified: number; awaitingResponse: number; overdueFollowUp: number; since: string };
export function LeadSummary({ onFilter, refreshKey }: { onFilter: (filters: Record<string, string>) => void; refreshKey: unknown }) {
  const [data, setData] = React.useState<Summary | null>(null);
  const [error, setError] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce(n => n + 1), []);
  useModuleRealtime('crm-lead-summary', ['leads', 'crm_activities'], reload);
  React.useEffect(() => {
    const c = new AbortController();
    getOne<Summary>('/api/crm/leads/summary', c.signal).then(value => { if (!c.signal.aborted) { setData(value); setError(false); } }).catch(() => { if (!c.signal.aborted) setError(true); });
    return () => c.abort();
  }, [nonce, refreshKey]);
  if (error) return <button onClick={reload} className="rounded-xl border p-3 text-left text-sm text-muted-foreground">Lead summary unavailable. Retry</button>;
  const cards = [
    { key: 'active', label: 'Active leads', hint: 'Open relationships', icon: Target, filters: { active: 'true' } },
    { key: 'recent', label: 'New in 30 days', hint: 'Rolling intake', icon: UserPlus, filters: { createdSince: data?.since ?? '' } },
    { key: 'unassigned', label: 'Unassigned', hint: 'Ready for an owner', icon: UserRound, filters: { unassigned: 'true', unconverted: 'true' } },
    { key: 'qualified', label: 'Qualified', hint: 'Ready for conversion', icon: CheckCheck, filters: { status: 'qualified', unconverted: 'true' } },
    { key: 'awaitingResponse', label: 'Awaiting response', hint: 'No logged call, email or meeting', icon: Clock, filters: { awaitingResponse: 'true' } },
    { key: 'overdueFollowUp', label: 'Overdue follow-up', hint: 'Active leads with work past due', icon: CalendarClock, filters: { overdueFollowUp: 'true' } },
  ] as const;
  return <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6" aria-label="Lead summary within your access">
    {cards.map(card => <button key={card.key} disabled={!data} onClick={() => onFilter(card.filters as Record<string, string>)} className="group rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30 focus-visible:outline-2 focus-visible:outline-blue-500">
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">{card.label}<card.icon className="size-4 text-blue-600" /></span>
      <span className="mt-2 block text-2xl font-semibold tracking-tight tabular-nums">{data ? data[card.key].toLocaleString() : '—'}</span>
      <span className="mt-1 block text-[11px] text-muted-foreground">{card.hint}</span>
    </button>)}
  </div>;
}
