'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Handshake, Check, X, ExternalLink } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';

import { exact, formatDay } from './data';
import { SectionHead, Blank, Spinner, Broken, Monogram } from './ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What partners have sent over
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is a queue and not a list ───────────────────────────────────
 *
 * An external salesperson submitting a prospect is waiting on a decision, and
 * the thing that makes a partner programme work or not is how long that wait
 * is. So the default view is what is outstanding, newest first, with the two
 * decisions on every row. Decided ones are behind a filter, where history
 * belongs.
 *
 * ── What accepting actually does ─────────────────────────────────────────
 *
 * Creates a lead. The partner never held one: their prospect lived in a table
 * they own, and this is the moment it enters the company's CRM with
 * `source_partner_id` stamped on it so the attribution survives. The two
 * writes happen inside `approve_partner_lead()` because a submission marked
 * accepted with no lead behind it is a promise about somebody's commission
 * that nothing will keep.
 */

interface Submission {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  note: string;
  estimatedValue: string | number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string;
  leadId: string | null;
  partner?: { profiles?: { fullName: string; avatarUrl: string | null } } | null;
  decider?: { profiles?: { fullName: string } } | null;
}

export function PartnerQueue({ onOpenLead }: { onOpenLead?: (id: string) => void }) {
  const [view, setView] = React.useState<'submitted' | 'approved' | 'rejected'>('submitted');
  const [nonce, setNonce] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const currency = useAppStore(s => s.organization?.currency) ?? 'USD';

  const [rows, setRows] = React.useState<Submission[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/crm/partner-leads?status=${view}`, { cache: 'no-store' })
      .then(async r => {
        const b = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok) { setError(b?.error?.message ?? 'That did not load.'); return; }
        setError(null);
        setRows(b?.data ?? []);
      })
      .catch(() => { if (live) setError('That did not load.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [view, nonce]);

  const decide = async (row: Submission, decision: 'approve' | 'reject') => {
    setBusy(row.id);
    try {
      const res = await fetch('/api/crm/partner-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, decision }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) throw new Error(b?.error?.message ?? 'That did not save.');
      toast.success(decision === 'approve' ? 'Accepted, and now a lead' : 'Declined');
      setNonce(n => n + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    } finally { setBusy(null); }
  };

  const TABS = [
    { id: 'submitted' as const, label: 'Waiting' },
    { id: 'approved' as const, label: 'Accepted' },
    { id: 'rejected' as const, label: 'Declined' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SectionHead
        title="From partners"
        count={view === 'submitted' ? rows.length : undefined}
        note="Prospects external salespeople have sent over"
      >
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              aria-current={view === t.id ? 'true' : undefined}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                view === t.id
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </SectionHead>

      {loading ? (
        <Spinner label="Reading the queue" />
      ) : error ? (
        <Broken message={error} onRetry={() => setNonce(n => n + 1)} />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-e1">
          <Blank
            icon={Handshake}
            title={view === 'submitted' ? 'Nothing waiting' : `Nothing ${view === 'approved' ? 'accepted' : 'declined'} yet`}
            body={view === 'submitted'
              ? 'When an external partner sends a prospect over, it lands here for a decision.'
              : 'Decisions you make appear here, with who made them.'}
          />
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1">
          {rows.map(r => {
            const who = [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
            const value = Number(r.estimatedValue ?? 0);
            return (
              <li key={r.id} className="flex items-start gap-3 px-4 py-3.5">
                <Monogram name={r.partner?.profiles?.fullName ?? '?'} />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-foreground">
                    {who || r.companyName || 'Unnamed prospect'}
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {[who && r.companyName ? r.companyName : null, r.jobTitle, r.email, r.phone]
                      .filter(Boolean).join(' · ') || 'No contact details given'}
                  </p>
                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    From {r.partner?.profiles?.fullName ?? 'a partner'}
                    {r.submittedAt ? ` · ${formatDay(r.submittedAt)}` : ''}
                    {r.decidedAt && r.decider?.profiles?.fullName
                      ? ` · decided by ${r.decider.profiles.fullName}` : ''}
                  </p>
                  {r.note && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                      {r.note}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {value > 0 && (
                    <span className="text-[13px] font-medium tabular-nums text-foreground">
                      {exact(value, currency)}
                    </span>
                  )}

                  {r.status === 'submitted' ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm" variant="outline" className="h-7 gap-1 px-2 text-[12px]"
                        disabled={busy === r.id}
                        onClick={() => decide(r, 'approve')}
                      >
                        <Check className="size-3" /> Accept
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 gap-1 px-2 text-[12px] text-muted-foreground"
                        disabled={busy === r.id}
                        onClick={() => decide(r, 'reject')}
                      >
                        <X className="size-3" /> Decline
                      </Button>
                    </div>
                  ) : r.status === 'approved' && r.leadId && onOpenLead ? (
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 gap-1 px-2 text-[12px] text-muted-foreground"
                      onClick={() => onOpenLead(r.leadId!)}
                    >
                      <ExternalLink className="size-3" /> Open the lead
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

