'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Coins, Check, X, Banknote, RotateCcw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';

import { useEndpoint, money, formatDay } from './data';
import {
  SectionHead, Avatar, Figure, FigureRow, Blank, Spinner, Broken,
  periodChoices, type PeriodChoice,
} from './ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What people earned, and why
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The one thing this screen must do ────────────────────────────────────
 *
 * Show the workings. Not a total with a name on it: the amount, what it was
 * calculated from, at what rate, under which version of which rule. That is
 * the whole reason `incentive_entries.explanation` exists, and a screen that
 * renders the amount without it would waste the entire design.
 *
 * ── Why the same screen serves three people ──────────────────────────────
 *
 * A salesperson reading their own earnings, a manager approving their team's,
 * and Finance marking things paid are looking at the same ledger with
 * different rights. The rows are identical; only the buttons differ, and the
 * endpoint says which ones to show rather than the client guessing from a
 * role name.
 */

interface Entry {
  id: string;
  memberId: string;
  ruleName: string;
  ruleVersion: number;
  basisAmount: string | number;
  currency: string;
  amount: string | number;
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'reversed';
  explanation: Record<string, any>;
  reversesEntryId: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  paidReference: string | null;
  note: string;
  earnedAt: string;
  member?: { profiles?: { fullName: string; avatarUrl: string | null; jobTitle: string | null } } | null;
  approver?: { profiles?: { fullName: string } } | null;
}

interface Meta {
  period: { start: string; end: string; label: string };
  currency: string;
  totals: Record<string, number>;
  mayApprove: boolean;
  mayPay: boolean;
}

const STATUS_WORD: Record<Entry['status'], string> = {
  pending: 'Awaiting approval',
  approved: 'Approved, not yet paid',
  rejected: 'Not approved',
  paid: 'Paid',
  reversed: 'Reversed',
};

/**
 * The sentence that makes an amount checkable.
 *
 * Built from the stored workings, never recomputed here: a screen that does
 * its own arithmetic can disagree with the ledger, and then nobody knows
 * which is right.
 */
function workings(e: Entry): string {
  const x = e.explanation ?? {};
  const cur = e.currency;
  const basis = Number(e.basisAmount ?? 0);

  if (x.reversal) {
    return `Reversed: ${x.reason ?? 'the underlying deal changed'}`;
  }
  if (x.kind === 'fixed') {
    return `Flat ${money(Number(x.fixedAmount ?? e.amount), cur)} under ${x.ruleName ?? e.ruleName}`;
  }
  if (x.kind === 'tiered') {
    return `${money(basis, cur)} x ${x.rate}%`
      + (x.tier ? ` (tier ${x.tier}, above ${money(Number(x.tierFrom ?? 0), cur)})` : '')
      + ` = ${money(Number(x.amount ?? e.amount), cur)}`;
  }
  if (x.kind === 'percentage') {
    return `${money(basis, cur)} x ${x.rate}% = ${money(Number(x.amount ?? e.amount), cur)}`;
  }
  return `Under ${e.ruleName}`;
}

export function EarningsSection({ mineOnly }: { mineOnly?: boolean }) {
  const choices = React.useMemo(() => periodChoices(), []);
  const [period, setPeriod] = React.useState<PeriodChoice>(choices[0]);
  const [nonce, setNonce] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const allows = useAppStore(s => s.allows);

  const url = React.useMemo(() => {
    const q = new URLSearchParams();
    if (mineOnly) q.set('mine', 'true');
    if (period.from) q.set('from', period.from);
    if (period.to) q.set('to', period.to);
    q.set('_', String(nonce));
    return `/api/performance/incentives?${q}`;
  }, [mineOnly, period, nonce]);

  const { data, meta, loading, error, reload } = useEndpoint<Entry[], Meta>(url);

  const move = async (entry: Entry, status: string) => {
    setBusy(entry.id);
    try {
      const res = await fetch(`/api/performance/incentives/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'That did not save.');
      toast.success(
        status === 'approved' ? 'Approved'
          : status === 'paid' ? 'Marked paid'
            : status === 'rejected' ? 'Not approved' : 'Updated',
      );
      setNonce(n => n + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Spinner label="Reading the ledger" />;
  if (error) return <Broken message={error} onRetry={reload} />;

  const rows = data ?? [];
  const currency = meta?.currency ?? 'USD';
  const t = meta?.totals;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionHead
          title={mineOnly ? 'Your earnings' : 'Earnings'}
          count={rows.length}
          note={
            allows('performance', 'approve') && !mineOnly
              ? 'Every amount shows the sum that produced it'
              : 'How each amount was worked out'
          }
        />
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
          {choices.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setPeriod(c)}
              aria-current={c.id === period.id ? 'true' : undefined}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                c.id === period.id
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {t && rows.length > 0 && (
        <FigureRow className="sm:grid-cols-4">
          <Figure
            label="Net earned"
            value={money(t.net ?? 0, currency)}
            sub="After any reversals"
            tone={(t.net ?? 0) > 0 ? 'success' : 'default'}
          />
          <Figure label="Awaiting approval" value={money(t.pending ?? 0, currency)} sub="Not yet signed off" />
          <Figure label="Approved" value={money(t.approved ?? 0, currency)} sub="Cleared, not yet paid" />
          <Figure label="Paid" value={money(t.paid ?? 0, currency)} sub="Money out" />
        </FigureRow>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-e1">
          <Blank
            icon={Coins}
            title="Nothing earned in this period"
            body={
              mineOnly
                ? 'Incentives appear here the moment a rule matches something you closed. If your company has no rules set up yet, there is nothing to show.'
                : 'No incentive has been calculated for anybody in this period.'
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1">
          {rows.map(e => {
            const amount = Number(e.amount ?? 0);
            const reversal = Boolean(e.reversesEntryId);
            const who = e.member?.profiles?.fullName ?? 'Unknown member';

            return (
              <li key={e.id} className={cn('px-4 py-3', e.status === 'reversed' && 'bg-muted/25')}>
                <div className="flex items-start gap-3">
                  {!mineOnly && <Avatar name={who} url={e.member?.profiles?.avatarUrl} />}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {!mineOnly && (
                        <span className="text-[13.5px] font-medium text-foreground">{who}</span>
                      )}
                      <span className="text-[12.5px] text-muted-foreground">
                        {e.explanation?.subject ?? e.ruleName}
                      </span>
                    </div>

                    {/*
                      The workings. This line is the reason the whole ledger is
                      shaped the way it is, so it is never truncated away and
                      never behind a disclosure.
                    */}
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                      {workings(e)}
                    </p>

                    <p className="mt-1 text-[11px] text-muted-foreground/85">
                      {e.ruleName} v{e.ruleVersion}
                      {' · '}{formatDay(e.earnedAt)}
                      {' · '}{STATUS_WORD[e.status]}
                      {e.approver?.profiles?.fullName && e.status !== 'pending'
                        ? ` by ${e.approver.profiles.fullName}` : ''}
                      {e.paidReference ? ` · ${e.paidReference}` : ''}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={cn(
                        'text-[15px] font-semibold tabular-nums',
                        reversal || amount < 0 ? 'text-destructive'
                          : e.status === 'paid' ? 'text-success'
                            : 'text-foreground',
                      )}
                    >
                      {money(amount, e.currency || currency)}
                    </span>

                    <div className="flex items-center gap-1">
                      {meta?.mayApprove && e.status === 'pending' && (
                        <>
                          <Button
                            size="sm" variant="outline" className="h-7 gap-1 px-2 text-[12px]"
                            disabled={busy === e.id}
                            onClick={() => move(e, 'approved')}
                          >
                            <Check className="size-3" /> Approve
                          </Button>
                          <Button
                            size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[12px] text-muted-foreground"
                            disabled={busy === e.id}
                            onClick={() => move(e, 'rejected')}
                          >
                            <X className="size-3" /> Decline
                          </Button>
                        </>
                      )}
                      {meta?.mayPay && e.status === 'approved' && (
                        <Button
                          size="sm" variant="outline" className="h-7 gap-1 px-2 text-[12px]"
                          disabled={busy === e.id}
                          onClick={() => move(e, 'paid')}
                        >
                          <Banknote className="size-3" /> Mark paid
                        </Button>
                      )}
                      {meta?.mayApprove && e.status === 'rejected' && (
                        <Button
                          size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[12px] text-muted-foreground"
                          disabled={busy === e.id}
                          onClick={() => move(e, 'pending')}
                        >
                          <RotateCcw className="size-3" /> Reopen
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
