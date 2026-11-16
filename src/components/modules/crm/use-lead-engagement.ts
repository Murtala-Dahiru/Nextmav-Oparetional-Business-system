'use client';
import * as React from 'react';
import { getOne } from './data';
import type { Lead } from './types';

export type LeadEngagement = { leadId: string; lastActivityAt: string | null; firstResponseAt: string | null; nextFollowUpAt: string | null; overdueCount: number };
export function useLeadEngagement(rows: Lead[]) {
  const [data, setData] = React.useState<Record<string, LeadEngagement>>({});
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    const c = new AbortController();
    setData({}); setError(false);
    if (rows.length) getOne<LeadEngagement[]>(`/api/crm/leads/engagement?ids=${rows.map(r => r.id).join(',')}`, c.signal)
      .then(result => { if (!c.signal.aborted) setData(Object.fromEntries(result.map(r => [r.leadId, r]))); })
      .catch(() => { if (!c.signal.aborted) setError(true); });
    return () => c.abort();
  }, [rows]);
  return { data, error };
}
