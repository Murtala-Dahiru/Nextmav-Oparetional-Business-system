import { dateIn } from '../org-time';

export interface InsightLead {
  source: string | null;
  created_at: string;
  converted_at: string | null;
}
export interface InsightDeal {
  created_at: string;
  value: number | string;
}

/** Current populations, not historical funnel transitions or stage durations. */
export function acquisitionSources(leads: InsightLead[]) {
  const sources = new Map<string, { source: string; count: number; converted: number }>();
  for (const lead of leads) {
    const source = lead.source?.trim().toLowerCase() || 'unknown';
    const row = sources.get(source) ?? { source, count: 0, converted: 0 };
    row.count++;
    if (lead.converted_at) row.converted++;
    sources.set(source, row);
  }
  return [...sources.values()].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

export function openDealAging(deals: InsightDeal[], today: string, zone: string) {
  const buckets = [
    { label: '0–14 days', min: 0, max: 14, count: 0, value: 0 },
    { label: '15–30 days', min: 15, max: 30, count: 0, value: 0 },
    { label: '31–60 days', min: 31, max: 60, count: 0, value: 0 },
    { label: '61–90 days', min: 61, max: 90, count: 0, value: 0 },
    { label: '91+ days', min: 91, max: Infinity, count: 0, value: 0 },
  ];
  let excluded = 0;
  for (const deal of deals) {
    const created = new Date(deal.created_at);
    const value = Number(deal.value);
    if (!Number.isFinite(created.getTime()) || !Number.isFinite(value) || value < 0) { excluded++; continue; }
    const age = Math.round((Date.parse(today) - Date.parse(dateIn(created, zone))) / 86_400_000);
    const bucket = buckets.find(b => age >= b.min && age <= b.max);
    if (!bucket) { excluded++; continue; }
    bucket.count++;
    bucket.value += value;
  }
  return { buckets: buckets.map(({ label, count, value }) => ({ label, count, value })), excluded };
}

export function recordedLossReasons(deals: { stage: string; lost_reason?: string | null }[]) {
  const reasons = new Map<string, number>();
  for (const deal of deals) {
    if (deal.stage !== 'closed_lost') continue;
    const reason = deal.lost_reason?.trim() || 'Not recorded';
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return [...reasons].map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
