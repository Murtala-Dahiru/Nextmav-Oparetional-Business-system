'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Plus, Scale, Power } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

import { useEndpoint, money, formatDay } from './data';
import { SectionHead, Blank, Spinner, Broken } from './ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Incentive rules
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why everybody can read this screen ───────────────────────────────────
 *
 * A commission scheme people cannot read is not a scheme, it is a rumour.
 * The requirement is that employees understand how their incentives are
 * calculated, and that is unmeetable if the rules live behind an admin gate.
 * So the list is open to the whole organisation and only the writing is
 * restricted, in the route and again in the RLS policy.
 *
 * ── Why the editor is deliberately plain ─────────────────────────────────
 *
 * Three shapes, chosen with radio buttons, each with one or two numbers. A
 * rule builder with conditions and operators would be more powerful and far
 * less trustworthy: nobody can predict what they will be paid from a formula
 * they have to parse, and a rule nobody can predict does not motivate
 * anybody. The complexity that belongs here is tiers, and that is as far as
 * it goes until a real case demands more.
 */

interface Rule {
  id: string;
  name: string;
  description: string;
  version: number;
  basis: 'booked_revenue' | 'collected_revenue' | 'per_event';
  triggerEvent: string;
  calculation: any;
  appliesToRole: string | null;
  appliesToDepartment: string | null;
  appliesToMember: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  department?: { name: string } | null;
  member?: { profiles?: { fullName: string } } | null;
}

const TRIGGERS = [
  { id: 'deal.won', label: 'A deal is won' },
  { id: 'invoice.paid', label: 'An invoice is paid' },
  { id: 'lead.qualified', label: 'A lead is qualified' },
  { id: 'lead.converted', label: 'A lead becomes a customer' },
];

const BASES = [
  { id: 'booked_revenue', label: 'Revenue booked', note: 'The value of the deal when it was won' },
  { id: 'collected_revenue', label: 'Revenue collected', note: 'What the customer actually paid' },
  { id: 'per_event', label: 'Per occurrence', note: 'A flat amount each time, with no sum to take a share of' },
];

const ROLES = [
  { id: '', label: 'Everybody' },
  { id: 'sales_staff', label: 'Sales staff' },
  { id: 'manager', label: 'Managers' },
  { id: 'support_staff', label: 'Support staff' },
  { id: 'employee', label: 'Employees' },
];

/** The rule, as a sentence somebody can check against their payslip. */
function describe(r: Rule, currency: string): string {
  const c = r.calculation ?? {};
  const basis = r.basis === 'collected_revenue' ? 'collected revenue'
    : r.basis === 'booked_revenue' ? 'booked revenue' : 'each one';

  if (c.kind === 'fixed') return `${money(Number(c.amount ?? 0), currency)} for ${basis}`;
  if (c.kind === 'percentage') return `${c.rate}% of ${basis}`;
  if (c.kind === 'tiered') {
    const tiers = (c.tiers ?? []) as { from: number; rate: number }[];
    return tiers
      .map((t, i) => (i === 0
        ? `${t.rate}% of ${basis}`
        : `${t.rate}% above ${money(Number(t.from), currency)}`))
      .join(', ');
  }
  return 'Not configured';
}

export function RulesSection() {
  const allows = useAppStore(s => s.allows);
  const mayWrite = allows('performance', 'manage');
  const [nonce, setNonce] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  const list = useEndpoint<Rule[]>(`/api/performance/rules?pageSize=100&_=${nonce}`);
  const currency = useAppStore(s => s.organization?.currency) ?? 'USD';

  if (list.loading && !list.data) return <Spinner label="Reading the rules" />;
  if (list.error) return <Broken message={list.error} onRetry={list.reload} />;

  const rules = list.data ?? [];
  const active = rules.filter(r => r.isActive);
  const retired = rules.filter(r => !r.isActive);

  const toggle = async (r: Rule) => {
    try {
      const res = await fetch(`/api/performance/rules/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !r.isActive }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error?.message ?? 'That did not save.');
      }
      toast.success(r.isActive ? 'Rule switched off' : 'Rule switched on');
      setNonce(n => n + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHead
        title="Incentive rules"
        count={active.length}
        note="How every amount in the ledger is worked out"
      >
        {mayWrite && (
          <Button size="sm" className="h-9 gap-1.5" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Add a rule
          </Button>
        )}
      </SectionHead>

      {rules.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-e1">
          <Blank
            icon={Scale}
            title="No incentive rules"
            body={mayWrite
              ? 'Until a rule exists, nothing is calculated and the earnings ledger stays empty. A rule says what fires it, what it applies to, and what it pays.'
              : 'Your company has not set up any incentive rules yet. When it does, they will be listed here in full.'}
            action={mayWrite ? <Button size="sm" onClick={() => setOpen(true)}>Add a rule</Button> : undefined}
          />
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1">
          {[...active, ...retired].map(r => (
            <li key={r.id} className={cn('px-4 py-3.5', !r.isActive && 'bg-muted/25')}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13.5px] font-medium text-foreground">{r.name}</span>
                    <span className="text-[11px] text-muted-foreground">v{r.version}</span>
                    {!r.isActive && (
                      <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                        Off
                      </span>
                    )}
                  </div>

                  {/*
                    The terms in words. This is what an employee reads to check
                    their own payslip, so it says the whole rule rather than
                    naming a strategy.
                  */}
                  <p className="mt-0.5 text-[12.5px] text-foreground/85">
                    {describe(r, currency)}
                  </p>

                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    When {TRIGGERS.find(t => t.id === r.triggerEvent)?.label.toLowerCase() ?? r.triggerEvent}
                    {' · '}
                    {r.appliesToMember?.length
                      ? `for ${r.member?.profiles?.fullName ?? 'one person'}`
                      : r.appliesToDepartment
                        ? `for ${r.department?.name ?? 'a department'}`
                        : r.appliesToRole
                          ? `for ${ROLES.find(x => x.id === r.appliesToRole)?.label ?? r.appliesToRole}`
                          : 'for everybody'}
                    {' · from '}{formatDay(r.effectiveFrom)}
                    {r.effectiveTo ? ` to ${formatDay(r.effectiveTo)}` : ''}
                  </p>

                  {r.description && (
                    <p className="mt-1 text-[11.5px] italic text-muted-foreground">{r.description}</p>
                  )}
                </div>

                {mayWrite && (
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 shrink-0 gap-1 px-2 text-[12px] text-muted-foreground"
                    onClick={() => toggle(r)}
                  >
                    <Power className="size-3" /> {r.isActive ? 'Switch off' : 'Switch on'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <RuleDialog open={open} onOpenChange={setOpen} onSaved={() => setNonce(n => n + 1)} currency={currency} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function RuleDialog({
  open, onOpenChange, onSaved, currency,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
  currency: string;
}) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [trigger, setTrigger] = React.useState('deal.won');
  const [basis, setBasis] = React.useState('booked_revenue');
  const [role, setRole] = React.useState('');
  const [kind, setKind] = React.useState<'percentage' | 'tiered' | 'fixed'>('percentage');
  const [rate, setRate] = React.useState('2.5');
  const [amount, setAmount] = React.useState('50000');
  const [tier2From, setTier2From] = React.useState('10000000');
  const [tier1Rate, setTier1Rate] = React.useState('1');
  const [tier2Rate, setTier2Rate] = React.useState('2.5');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(''); setDescription(''); setTrigger('deal.won'); setBasis('booked_revenue');
    setRole(''); setKind('percentage'); setRate('2.5'); setAmount('50000');
    setTier2From('10000000'); setTier1Rate('1'); setTier2Rate('2.5');
  }, [open]);

  /* Flat amounts have nothing to take a percentage of. */
  React.useEffect(() => {
    if (basis === 'per_event' && kind !== 'fixed') setKind('fixed');
  }, [basis, kind]);

  const calculation = React.useMemo(() => {
    if (kind === 'fixed') return { kind: 'fixed', amount: Number(amount) };
    if (kind === 'percentage') return { kind: 'percentage', rate: Number(rate) };
    return {
      kind: 'tiered',
      tiers: [
        { from: 0, rate: Number(tier1Rate) },
        { from: Number(tier2From), rate: Number(tier2Rate) },
      ],
    };
  }, [kind, rate, amount, tier1Rate, tier2Rate, tier2From]);

  const preview = React.useMemo(() => {
    const sample = 11_600_000;
    if (kind === 'fixed') return `Every time: ${money(Number(amount) || 0, currency)}`;
    if (kind === 'percentage') {
      return `On ${money(sample, currency)}: ${money(sample * (Number(rate) || 0) / 100, currency)}`;
    }
    const r = sample >= Number(tier2From) ? Number(tier2Rate) : Number(tier1Rate);
    return `On ${money(sample, currency)}: ${money(sample * r / 100, currency)} (${r}%)`;
  }, [kind, rate, amount, tier1Rate, tier2Rate, tier2From, currency]);

  const save = async () => {
    if (!name.trim()) return toast.error('Give the rule a name people will recognise');
    setSaving(true);
    try {
      const res = await fetch('/api/performance/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description,
          triggerEvent: trigger,
          basis,
          calculation,
          appliesToRole: role || null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'That did not save.');
      toast.success('Rule added');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an incentive rule</DialogTitle>
          <DialogDescription>
            Everybody in the company can read this rule. Write it so somebody can
            check their own payslip against it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name" value={name} onChange={e => setName(e.target.value)}
              placeholder="Sales commission"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-trigger">Fires when</Label>
              <select
                id="rule-trigger" value={trigger} onChange={e => setTrigger(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
              >
                {TRIGGERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-who">Applies to</Label>
              <select
                id="rule-who" value={role} onChange={e => setRole(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
              >
                {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-basis">Calculated on</Label>
            <select
              id="rule-basis" value={basis} onChange={e => setBasis(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
            >
              {BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
            <p className="text-[11.5px] text-muted-foreground">
              {BASES.find(b => b.id === basis)?.note}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Pays</Label>
            <div className="flex flex-wrap gap-1.5">
              {(['percentage', 'tiered', 'fixed'] as const).map(k => (
                <button
                  key={k}
                  type="button"
                  disabled={basis === 'per_event' && k !== 'fixed'}
                  onClick={() => setKind(k)}
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                    kind === k
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:text-foreground',
                    basis === 'per_event' && k !== 'fixed' && 'cursor-not-allowed opacity-40',
                  )}
                >
                  {k === 'percentage' ? 'A percentage' : k === 'tiered' ? 'Tiered' : 'A flat amount'}
                </button>
              ))}
            </div>

            {kind === 'percentage' && (
              <div className="flex items-center gap-2">
                <Input
                  className="w-24" inputMode="decimal" value={rate}
                  onChange={e => setRate(e.target.value)} aria-label="Rate"
                />
                <span className="text-[13px] text-muted-foreground">% of the amount</span>
              </div>
            )}

            {kind === 'fixed' && (
              <div className="flex items-center gap-2">
                <Input
                  className="w-36" inputMode="decimal" value={amount}
                  onChange={e => setAmount(e.target.value)} aria-label="Amount"
                />
                <span className="text-[13px] text-muted-foreground">each time</span>
              </div>
            )}

            {kind === 'tiered' && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                  <Input className="w-20" inputMode="decimal" value={tier1Rate}
                    onChange={e => setTier1Rate(e.target.value)} aria-label="First rate" />
                  <span>% normally, then</span>
                  <Input className="w-20" inputMode="decimal" value={tier2Rate}
                    onChange={e => setTier2Rate(e.target.value)} aria-label="Second rate" />
                  <span>% above</span>
                  <Input className="w-32" inputMode="decimal" value={tier2From}
                    onChange={e => setTier2From(e.target.value)} aria-label="Tier threshold" />
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  The higher rate applies to the whole amount, not just the part above the
                  threshold. That is the version a person can work out in their head.
                </p>
              </div>
            )}
          </div>

          {/*
            What it would actually pay.

            A rule nobody can predict does not motivate anybody, so the editor
            shows the answer on a realistic figure before the rule is saved.
          */}
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85">
              What this pays
            </p>
            <p className="mt-0.5 text-[13px] tabular-nums text-foreground">{preview}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-desc">Notes</Label>
            <Textarea
              id="rule-desc" rows={2} value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Anything a person should know when reading this"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving' : 'Add rule'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
