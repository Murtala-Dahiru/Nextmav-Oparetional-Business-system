'use client';
import * as React from 'react';
import { formatRelativeTime } from '@/lib/format';
import { useLeadEngagement } from './use-lead-engagement';
import type { Lead } from './types';

export function LeadEngagementPanel({ lead }: { lead: Lead }) {
  const rows = React.useMemo(() => [lead], [lead]);
  const { data, error } = useLeadEngagement(rows);
  const engagement = data[lead.id];
  const last = engagement?.lastActivityAt ?? lead.createdAt;
  const neglected = Date.now() - Date.parse(last) >= 14 * 86400000 && !lead.convertedContactId && !['won', 'lost'].includes(lead.status);
  return <section className="rounded-xl border bg-card p-4" aria-label="Lead engagement">
    <h3 className="text-sm font-semibold">Engagement</h3>
    {error ? <p className="mt-2 text-xs text-muted-foreground">Engagement summary unavailable. Review the Activity tab.</p> : !engagement ? <p className="mt-2 text-xs text-muted-foreground">Loading engagement…</p> : <>
      <dl className="mt-3 grid grid-cols-2 gap-4 text-xs">
        <div><dt className="text-muted-foreground">First recorded response</dt><dd className="mt-1 font-medium">{engagement.firstResponseAt ? formatRelativeTime(engagement.firstResponseAt) : 'No call, email or meeting logged'}</dd></div>
        <div><dt className="text-muted-foreground">Last activity</dt><dd className="mt-1 font-medium">{engagement.lastActivityAt ? formatRelativeTime(engagement.lastActivityAt) : 'No activity recorded'}</dd></div>
        <div><dt className="text-muted-foreground">Next follow-up</dt><dd className="mt-1 font-medium">{engagement.nextFollowUpAt ? formatRelativeTime(engagement.nextFollowUpAt) : 'No next step scheduled'}</dd></div>
        <div><dt className="text-muted-foreground">Overdue follow-ups</dt><dd className={engagement.overdueCount ? 'mt-1 font-medium text-amber-700' : 'mt-1 font-medium'}>{engagement.overdueCount}</dd></div>
      </dl>
      {neglected && <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">Needs attention: no recorded activity in 14 days.</p>}
      <p className="mt-3 text-[10px] text-muted-foreground">Based on logged activity. Scheduled, incomplete calls do not count as a response.</p>
    </>}
  </section>;
}
