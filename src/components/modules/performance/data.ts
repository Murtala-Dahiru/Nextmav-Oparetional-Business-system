'use client';

import * as React from 'react';
import { formatCurrencyCompact, formatCurrency, formatNumber } from '@/lib/format';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The module's shared reading and formatting
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deliberately a copy of CRM's `data.ts` shape rather than an import of it.
 * The two modules answer to different endpoints and will drift; sharing a
 * fetch helper across module boundaries is how one module's change breaks
 * another's screen, which this repository has already paid for once.
 */

export interface Fetched<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** One endpoint, with the loading and error states the screens actually use. */
export function useEndpoint<T>(url: string | null): Fetched<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(Boolean(url));
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (!url) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    setError(null);

    fetch(url, { cache: 'no-store' })
      .then(async res => {
        const body = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok) {
          setError(body?.error?.message ?? body?.message ?? 'That did not load.');
          setData(null);
          return;
        }
        setData(body?.data ?? null);
      })
      .catch(() => { if (live) setError('That did not load.'); })
      .finally(() => { if (live) setLoading(false); });

    return () => { live = false; };
  }, [url, nonce]);

  return { data, loading, error, reload: () => setNonce(n => n + 1) };
}

/**
 * Money, without the decimals a CRM figure never needs.
 *
 * The same reasoning as the CRM's `exact()`: `formatCurrency` forces two
 * decimal places, which is right for an invoice line and wrong for every
 * figure on a performance screen. Whole values lose them; a value that
 * genuinely has kobo keeps them.
 */
export function money(value: number, currency: string): string {
  if (!Number.isFinite(value)) return '-';
  return Number.isInteger(value)
    ? formatCurrencyCompact(value, currency)
    : formatCurrency(value, currency);
}

/** A metric's value, formatted by what it is rather than by its type. */
export function metricValue(value: number, unit: 'money' | 'count', currency: string): string {
  return unit === 'money' ? money(value, currency) : formatNumber(Math.round(value));
}

/** A ratio as a percentage, or a dash when there is nothing to divide. */
export function percent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '-';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/**
 * How a target is doing, in words rather than a colour alone.
 *
 * Progress on its own is not a judgement: 62% is good in week two and bad in
 * week eleven. Comparing it against how much of the period has gone is what
 * makes it readable, and it is the whole reason the endpoint returns `pace`.
 */
export function targetStanding(
  progress: number | null,
  pace: number,
): { tone: 'success' | 'warning' | 'critical' | 'default'; word: string } {
  if (progress === null) return { tone: 'default', word: 'No target set' };
  if (progress >= 1) return { tone: 'success', word: 'Target met' };
  /* Before the period really starts, a comparison says nothing. */
  if (pace < 0.1) return { tone: 'default', word: 'Just started' };

  const ratio = progress / pace;
  if (ratio >= 1.05) return { tone: 'success', word: 'Ahead of pace' };
  if (ratio >= 0.9) return { tone: 'default', word: 'On pace' };
  if (ratio >= 0.7) return { tone: 'warning', word: 'Behind pace' };
  return { tone: 'critical', word: 'Well behind' };
}

/** A date in the reader's own calendar, without the UTC trap on bare dates. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '-';
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(bare ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '-';
  const now = new Date();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** A month key like `2026-08`, as `Aug`. */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'short' });
}

export const STAGE_LABELS: Record<string, string> = {
  prospecting: 'Prospecting',
  qualification: 'Qualification',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closed_won: 'Won',
  closed_lost: 'Lost',
};

/** What an event says, in the words a person would use. */
export const EVENT_LABELS: Record<string, string> = {
  'deal.won': 'Won',
  'deal.lost': 'Lost',
  'deal.reopened': 'Reopened',
  'invoice.paid': 'Paid',
  'lead.qualified': 'Qualified',
  'lead.converted': 'Converted',
};
