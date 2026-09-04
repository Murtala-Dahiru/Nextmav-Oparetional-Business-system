'use client';

import * as React from 'react';
import { ArrowLeft, Plus, Play, ShieldCheck, Wallet } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, Head, Stat, Bar, THead, TRow } from '@/components/shared/readout/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  PAYROLL_STATUS_LABELS, PAYROLL_NEXT, PAY_PERIOD_LABELS, COMP_REASON_LABELS,
  labelOf, type PayrollRunStatus,
} from '@/lib/hr';

import { getList, getOne, post, patch, money, whenWord, todayISO, shiftISO } from './data';
import { PersonCell, Blank, Skeleton, Pill, Verdict, Restricted, day, Field } from './ui';
import { CompensationDialog } from './forms';
import type {
  PayrollPeriod, PayrollItem, Ruleset, StarterRulesetOption,
  CompensationRecord, Person, CalculationResult,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Pay - compensation and payroll
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * A "Run Payroll Batch" button attached to nothing, over a table of three
 * people with dollar salaries typed into a `useState` array, and a "Next Pay
 * Date" of August 1st that would still have said August 1st in December.
 *
 * ── The rule this screen exists to enforce ───────────────────────────────
 *
 * **No payroll figure is drawn without its verdict.** `describeRuleset()`
 * decides whether the arithmetic behind a number can be trusted, and the
 * `Verdict` component renders it beside every total on this screen. The
 * dangerous state is the middle one - a ruleset with steps that nobody has
 * certified computes something believable, which is exactly when a person
 * believes it - so the caveat appears there too, not only when the ruleset is
 * empty.
 *
 * ── Approval is a door that does not reopen ──────────────────────────────
 *
 * An approved run refuses recalculation, editing and deletion, in the
 * database. This screen draws only the transitions `PAYROLL_NEXT` permits, so
 * a control that cannot work is not offered - but the ladder here is a
 * rendering aid and the refusal is the trigger.
 */

export function Pay({
  canSeePay,
  selfMemberId,
}: {
  canSeePay: boolean;
  selfMemberId: string;
}) {
  const [view, setView] = React.useState<'runs' | 'compensation' | 'rules' | 'payslips'>(
    canSeePay ? 'runs' : 'payslips',
  );

  return (
    <div className="nm-enter space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {([
          ...(canSeePay ? [
            ['runs', 'Pay runs'] as const,
            ['compensation', 'Compensation'] as const,
            ['rules', 'Rules'] as const,
          ] : []),
          ['payslips', 'My payslips'] as const,
        ]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id as typeof view)}
            aria-pressed={view === id}
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
              view === id
                ? 'border-foreground/20 bg-accent text-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'runs' && canSeePay ? <PayRuns /> : null}
      {view === 'compensation' && canSeePay ? <Compensation /> : null}
      {view === 'rules' && canSeePay ? <Rulesets /> : null}
      {view === 'payslips' ? <Payslips selfMemberId={selfMemberId} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pay runs                                                                  */
/* -------------------------------------------------------------------------- */

function PayRuns() {
  const [periods, setPeriods] = React.useState<PayrollPeriod[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setPeriods((await getList<PayrollPeriod>('/api/hr/payroll/periods')).data);
    } catch (e: any) {
      toast.error(e.message || 'Could not load pay runs');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  if (openId) {
    return <PayRun periodId={openId} onBack={() => { setOpenId(null); load(); }} />;
  }

  if (loading) return <Card><Skeleton rows={4} /></Card>;

  const awaiting = periods.filter(p => p.status === 'calculated').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted-foreground">
          {periods.length
            ? `${periods.length} run${periods.length === 1 ? '' : 's'}${awaiting ? `, ${awaiting} awaiting approval` : ''}`
            : 'No pay runs yet'}
        </p>
        <Button size="sm" className="h-8 text-[12.5px]" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 size-3.5" />
          New pay run
        </Button>
      </div>

      <Card>
        <div className="px-4 pt-3.5">
          <Head title="Pay runs" count={periods.length} />
        </div>
        {periods.length ? (
          <div className="mt-2.5 px-2 pb-2">
            <THead columns="grid-cols-[minmax(0,1.5fr)_auto] md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto_auto]">
              <span>Run</span>
              <span className="hidden md:block">Period</span>
              <span className="hidden text-right md:block">People</span>
              <span className="hidden text-right md:block">Net</span>
              <span className="text-right">Status</span>
            </THead>
            {periods.map(p => (
              <TRow
                key={p.id}
                columns="grid-cols-[minmax(0,1.5fr)_auto] md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto_auto]"
                onClick={() => setOpenId(p.id)}
                ariaLabel={`Open ${p.name}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {p.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    Pay date {day(p.payDate)}
                    {p.ruleset ? ` · ${p.ruleset.name}` : ' · no ruleset'}
                    {p.ruleset && !p.ruleset.isStatutoryComplete ? ' · uncertified' : ''}
                  </span>
                </span>
                <span className="hidden truncate text-[12.5px] text-muted-foreground md:block">
                  {day(p.periodStart)} – {day(p.periodEnd)}
                </span>
                <span className="hidden text-right text-[12.5px] tabular-nums text-muted-foreground md:block">
                  {p.employeeCount}
                </span>
                <span className="hidden text-right text-[12.5px] font-medium tabular-nums text-foreground md:block">
                  {money(p.totalNet, p.currency)}
                </span>
                <span className="flex justify-end">
                  <Pill tone={
                    p.status === 'paid' ? 'good'
                      : p.status === 'approved' ? 'accent'
                        : p.status === 'cancelled' ? 'quiet' : 'warn'
                  }>
                    {labelOf(PAYROLL_STATUS_LABELS, p.status)}
                  </Pill>
                </span>
              </TRow>
            ))}
          </div>
        ) : (
          <Blank
            title="No pay runs"
            note="A run covers a period, reads the compensation in force on its pay date, and freezes its figures when it is approved."
            action={<Button size="sm" onClick={() => setCreating(true)}>Create one</Button>}
          />
        )}
      </Card>

      {creating ? (
        <NewRunDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />
      ) : null}
    </div>
  );
}

function PayRun({ periodId, onBack }: { periodId: string; onBack: () => void }) {
  const [period, setPeriod] = React.useState<PayrollPeriod | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [excluded, setExcluded] = React.useState<CalculationResult['excluded']>([]);
  const [openItem, setOpenItem] = React.useState<PayrollItem | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setPeriod(await getOne<PayrollPeriod>(`/api/hr/payroll/periods/${periodId}`));
    } catch (e: any) {
      toast.error(e.message || 'Could not load the run');
    } finally {
      setLoading(false);
    }
  }, [periodId]);

  React.useEffect(() => { load(); }, [load]);

  async function calculate() {
    setBusy(true);
    try {
      const result = await post<CalculationResult>(`/api/hr/payroll/periods/${periodId}/calculate`);
      setExcluded(result.excluded ?? []);
      toast.success(`${result.calculated} payslip${result.calculated === 1 ? '' : 's'} calculated`);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Could not calculate the run');
    } finally {
      setBusy(false);
    }
  }

  async function move(status: PayrollRunStatus) {
    setBusy(true);
    try {
      await patch(`/api/hr/payroll/periods/${periodId}`, { status });
      toast.success(
        status === 'paid' ? 'Marked paid — everybody has been told their payslip is ready'
          : status === 'approved' ? 'Run approved. Its figures are now final.'
            : `Run ${status}`,
      );
      load();
    } catch (e: any) {
      toast.error(e.message || 'Could not update the run');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Card><Skeleton rows={5} /></Card>;
  if (!period) {
    return <Card><Blank title="Not available" action={<Button size="sm" variant="outline" onClick={onBack}>Back</Button>} /></Card>;
  }

  const items = period.items ?? [];
  const next = PAYROLL_NEXT[period.status] ?? [];
  const frozen = ['approved', 'paid'].includes(period.status);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Pay runs
      </button>

      <Verdict verdict={period.verdict} />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-foreground">
                {period.name}
              </h2>
              <Pill tone={
                period.status === 'paid' ? 'good'
                  : period.status === 'approved' ? 'accent'
                    : period.status === 'cancelled' ? 'quiet' : 'warn'
              }>
                {labelOf(PAYROLL_STATUS_LABELS, period.status)}
              </Pill>
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {day(period.periodStart)} – {day(period.periodEnd)} · pay date {day(period.payDate)} ·{' '}
              {period.periodsPerYear} periods a year
            </p>
            {period.approvedAt ? (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Approved {whenWord(period.approvedAt.slice(0, 10))}
                {period.approver?.profiles?.fullName ? ` by ${period.approver.profiles.fullName}` : ''}
                {period.expenseId ? ' · recorded in Finance' : ''}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {!frozen ? (
              <Button size="sm" variant="outline" className="h-8 text-[12.5px]"
                      onClick={calculate} disabled={busy}>
                <Play className="mr-1.5 size-3.5" />
                {items.length ? 'Recalculate' : 'Calculate'}
              </Button>
            ) : null}

            {next.filter(s => s !== 'cancelled').map(s => (
              <Button
                key={s}
                size="sm"
                className="h-8 text-[12.5px]"
                variant={s === 'paid' ? 'default' : s === 'approved' ? 'default' : 'outline'}
                disabled={busy || (s === 'approved' && items.length === 0)}
                onClick={() => move(s)}
              >
                {s === 'approved' ? 'Approve' : s === 'paid' ? 'Mark paid' : labelOf(PAYROLL_STATUS_LABELS, s)}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-y divide-border border-t border-border sm:grid-cols-4 sm:divide-y-0">
          <Stat label="People" value={period.employeeCount} />
          <Stat label="Gross" value={money(period.totalGross, period.currency)} />
          <Stat label="Deductions" value={money(period.totalDeductions, period.currency)} />
          <Stat label="Net" value={money(period.totalNet, period.currency)} />
        </div>

        {period.totalEmployerCost ? (
          <p className="border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
            Employer contributions of {money(period.totalEmployerCost, period.currency)} on top,
            which never touch anybody&rsquo;s net pay and are part of what the business budgets for.
          </p>
        ) : null}

        {frozen ? (
          <p className="border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
            This run has been approved. Its figures are final and cannot be recalculated —
            correcting it means cancelling it and creating a new one.
          </p>
        ) : null}
      </Card>

      {excluded.length ? (
        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Not in this run" count={excluded.length} />
          </div>
          <ul className="mt-1 divide-y divide-border">
            {excluded.map(x => (
              <li key={x.memberId} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="truncate text-[12.5px] text-foreground">{x.name}</span>
                <span className="shrink-0 text-[11.5px] text-warning">{x.reason}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
            Somebody with no compensation record is excluded and reported here, not paid zero.
            A payslip for nothing looks like a decision.
          </p>
        </Card>
      ) : null}

      <Card>
        <div className="px-4 pt-3.5">
          <Head title="Payslips" count={items.length} />
        </div>
        {items.length ? (
          <div className="mt-2.5 px-2 pb-2">
            <THead columns="grid-cols-[minmax(0,1.6fr)_auto_auto] md:grid-cols-[minmax(0,1.6fr)_auto_auto_auto_auto]">
              <span>Person</span>
              <span className="hidden text-right md:block">Base</span>
              <span className="text-right">Gross</span>
              <span className="hidden text-right md:block">Deductions</span>
              <span className="text-right">Net</span>
            </THead>
            {items.map(i => (
              <TRow
                key={i.id}
                columns="grid-cols-[minmax(0,1.6fr)_auto_auto] md:grid-cols-[minmax(0,1.6fr)_auto_auto_auto_auto]"
                onClick={() => setOpenItem(i)}
                ariaLabel={`Open payslip for ${i.member?.profiles?.fullName ?? 'an employee'}`}
              >
                <PersonCell
                  id={i.member?.id ?? i.memberId}
                  name={i.member?.profiles?.fullName}
                  avatarUrl={i.member?.profiles?.avatarUrl}
                  secondary={i.member?.department?.name}
                />
                <span className="hidden text-right text-[12.5px] tabular-nums text-muted-foreground md:block">
                  {money(i.baseAmount, i.currency)}
                </span>
                <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {money(i.gross, i.currency)}
                </span>
                <span className="hidden text-right text-[12.5px] tabular-nums text-muted-foreground md:block">
                  {money(i.totalDeductions, i.currency)}
                </span>
                <span className="text-right text-[12.5px] font-semibold tabular-nums text-foreground">
                  {money(i.net, i.currency)}
                </span>
              </TRow>
            ))}
          </div>
        ) : (
          <Blank
            title="Not calculated yet"
            note="Calculating reads each person's compensation as it stood on the pay date, applies the ruleset, and writes a payslip with its workings frozen onto it."
            action={!frozen ? (
              <Button size="sm" onClick={calculate} disabled={busy}>Calculate</Button>
            ) : undefined}
          />
        )}
      </Card>

      <PostingPanel periodId={periodId} status={period.status} />

      {openItem ? (
        <PayslipDialog item={openItem} onClose={() => setOpenItem(null)} />
      ) : null}
    </div>
  );
}

interface Posting {
  posted: boolean;
  reason?: string;
  period: { currency: string; expenseId: string | null; status: string };
  categories: { category: string; label: string; owedTo: string; amount: number; note: string }[];
  totals: {
    gross: number; netPay: number; deductions: number; employerContributions: number;
    totalCost: number; dueToEmployees: number; dueToThirdParties: number; currency: string;
  } | null;
  byDepartment: {
    departmentId: string | null; department: string;
    netPay: number; deductions: number; employerContributions: number; employees: number;
  }[];
  reconciles: {
    netMatchesPeriod: boolean; deductionsMatchPeriod: boolean;
    employerMatchesPeriod: boolean; grossHolds: boolean; note: string;
  } | null;
}

/**
 * What this run owes, and to whom.
 *
 * ── Why this is on the payroll screen and not in Finance ─────────────────
 *
 * Finance is not being rebuilt here, and this writes nothing into it. What it
 * does is show the seam: the three obligations a run creates, already
 * aggregated so that no individual pay is derivable, in the shape a finance
 * team can act on. The single expense row Finance actually receives (0042) is
 * named at the bottom so nobody has to guess whether the two are about the
 * same money.
 *
 * ── Why the reconciliation is shown rather than assumed ──────────────────
 *
 * The posting and the run's own totals come from the same items, so they
 * agree — right up until something is wrong, and that is the moment somebody
 * is about to file a return from these numbers. A line that says "this
 * balances" is worth the space; the alternative is a table that looks equally
 * convincing either way.
 */
function PostingPanel({ periodId, status }: { periodId: string; status: string }) {
  const [data, setData] = React.useState<Posting | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    getOne<Posting>(`/api/hr/payroll/periods/${periodId}/posting`)
      .then(d => { if (live) setData(d); })
      .catch(() => { if (live) setData(null); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [periodId, status]);

  if (loading) return <Card><Skeleton rows={3} /></Card>;
  if (!data) return null;

  if (!data.posted) {
    return (
      <Card>
        <div className="px-4 pt-3.5">
          <Head title="What this run owes" />
        </div>
        <Blank title="Not yet stated" note={data.reason ?? 'A run states what it owes once it has been approved.'} />
      </Card>
    );
  }

  const t = data.totals!;
  const r = data.reconciles!;
  const balanced = r.grossHolds && r.netMatchesPeriod
    && r.deductionsMatchPeriod && r.employerMatchesPeriod;

  return (
    <Card>
      <div className="px-4 pt-3.5">
        <Head title="What this run owes" />
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          The figures a finance team needs, aggregated so no individual&rsquo;s pay can be worked
          out from them. Nothing here is posted to an account — payroll says what it owes and
          Finance does the accounting.
        </p>
      </div>

      <ul className="mt-2.5 divide-y divide-border border-t border-border">
        {data.categories.map(c => (
          <li key={c.category} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground">{c.label}</p>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">{c.note}</p>
            </div>
            <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-foreground">
              {money(c.amount, t.currency)}
            </span>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-2 divide-x divide-y divide-border border-t border-border sm:grid-cols-3 sm:divide-y-0">
        <Stat label="Leaves on the pay date" value={money(t.dueToEmployees, t.currency)} />
        <Stat label="Held and remitted later" value={money(t.dueToThirdParties, t.currency)} />
        <Stat label="Total cost to the company" value={money(t.totalCost, t.currency)} />
      </div>

      {data.byDepartment.length > 1 && (
        <div className="border-t border-border px-2 pb-2 pt-2.5">
          <div className="px-2">
            <Head title="By cost centre" count={data.byDepartment.length} />
          </div>
          <div className="mt-1.5 overflow-x-auto">
            <THead columns="grid-cols-[minmax(0,1.4fr)_auto_auto_auto]">
              <span>Department</span>
              <span className="text-right">Net</span>
              <span className="text-right">Withheld</span>
              <span className="text-right">Employer</span>
            </THead>
            {data.byDepartment.map(d => (
              <TRow key={d.departmentId ?? 'none'} columns="grid-cols-[minmax(0,1.4fr)_auto_auto_auto]">
                <span className="truncate text-[12.5px] text-foreground">
                  {d.department}
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    {d.employees} {d.employees === 1 ? 'person' : 'people'}
                  </span>
                </span>
                <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {money(d.netPay, t.currency)}
                </span>
                <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {money(d.deductions, t.currency)}
                </span>
                <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {money(d.employerContributions, t.currency)}
                </span>
              </TRow>
            ))}
          </div>
        </div>
      )}

      <p className={cn(
        'border-t border-border px-4 py-2.5 text-[11.5px] leading-relaxed',
        balanced ? 'text-muted-foreground' : 'text-warning',
      )}>
        {balanced
          ? `Net pay plus what was withheld equals the gross, and every total agrees with the run. ${r.note}`
          : `These figures do not agree with the run's own totals. ${r.note} If nobody is on hold, this needs looking at before anything is filed from it.`}
      </p>

      {data.period.expenseId && (
        <p className="border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
          Finance has one expense row for this run, carrying the total and naming nobody. This
          panel explains that row; it does not duplicate it.
        </p>
      )}
    </Card>
  );
}

/**
 * One payslip, and how every line on it was arrived at.
 *
 * The explanation column is the reason `payroll_lines.explanation` exists: "8%
 * of base pay (450000.00)" is what turns a deduction from something that
 * happened to somebody into something they can check.
 */
function PayslipDialog({ item, onClose }: { item: PayrollItem; onClose: () => void }) {
  const lines = [...(item.lines ?? [])].sort((a, b) => a.sequence - b.sequence);
  const earnings = lines.filter(l => l.kind === 'earning');
  const deductions = lines.filter(l => l.kind === 'deduction');
  const employer = lines.filter(l => l.kind === 'employer_cost');

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item.member?.profiles?.fullName ?? 'Payslip'}</DialogTitle>
          <DialogDescription>
            {item.period?.name}
            {item.period?.payDate ? ` · paid ${day(item.period.payDate)}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              Earnings
            </h3>
            <ul className="mt-1.5 divide-y divide-border">
              {earnings.map(l => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-foreground">{l.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {l.explanation}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12.5px] tabular-nums text-foreground">
                    {money(l.amount, item.currency)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 flex justify-between border-t border-border pt-1.5">
              <span className="text-[12px] font-medium text-muted-foreground">Gross</span>
              <span className="text-[12.5px] font-semibold tabular-nums text-foreground">
                {money(item.gross, item.currency)}
              </span>
            </div>
          </section>

          {deductions.length ? (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                Deductions
              </h3>
              <ul className="mt-1.5 divide-y divide-border">
                {deductions.map(l => (
                  <li key={l.id} className="flex items-start justify-between gap-3 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-foreground">{l.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {l.explanation}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12.5px] tabular-nums text-foreground">
                      −{money(l.amount, item.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="flex items-baseline justify-between rounded-lg bg-muted/50 px-3 py-2.5">
            <span className="text-[12.5px] font-medium text-foreground">Net pay</span>
            <span className="text-[19px] font-semibold tabular-nums tracking-[-0.02em] text-foreground">
              {money(item.net, item.currency)}
            </span>
          </div>

          {employer.length ? (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                Employer contributions
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Paid by the company on top of the wage. They do not affect net pay.
              </p>
              <ul className="mt-1.5 divide-y divide-border">
                {employer.map(l => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="truncate text-[12.5px] text-muted-foreground">{l.label}</span>
                    <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
                      {money(l.amount, item.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* What was skipped, and why. A step that did not apply is
              information; silently omitting it is how somebody concludes their
              pension was forgotten. */}
          {Array.isArray(item.workings?.skipped) && item.workings.skipped.length ? (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                Not applied
              </h3>
              <ul className="mt-1.5 space-y-1">
                {item.workings.skipped.map((s: any) => (
                  <li key={s.code} className="text-[11.5px] text-muted-foreground">
                    <span className="font-medium text-foreground">{s.code}</span> — {s.reason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {item.workings?.isStatutoryComplete === false ? (
            <p className="rounded-lg border border-warning/30 bg-warning/[0.07] px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
              This was calculated with a ruleset that had not been confirmed as the full
              statutory rules for its jurisdiction. Treat the figures as an estimate.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewRunDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const today = todayISO();
  const [name, setName] = React.useState(
    new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  );
  const [periodStart, setPeriodStart] = React.useState(`${today.slice(0, 7)}-01`);
  const [periodEnd, setPeriodEnd] = React.useState(today);
  const [payDate, setPayDate] = React.useState(today);
  const [rulesetId, setRulesetId] = React.useState('');
  const [periodsPerYear, setPeriodsPerYear] = React.useState('12');
  const [rulesets, setRulesets] = React.useState<Ruleset[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    getOne<{ rulesets: Ruleset[] }>('/api/hr/payroll/rulesets')
      .then(d => {
        const active = (d.rulesets ?? []).filter(r => r.isActive);
        setRulesets(active);
        if (active.length === 1) setRulesetId(active[0].id);
      })
      .catch(() => undefined);
  }, []);

  const chosen = rulesets.find(r => r.id === rulesetId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/api/hr/payroll/periods', {
        name: name.trim(),
        period_start: periodStart,
        period_end: periodEnd,
        pay_date: payDate,
        ruleset_id: rulesetId || undefined,
        periods_per_year: Number(periodsPerYear) || 12,
      });
      toast.success('Pay run created');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not create the run');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New pay run</DialogTitle>
          <DialogDescription>
            It reads each person&rsquo;s compensation as it stood on the pay date.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="March 2026" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Period start</Label>
              <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Period end</Label>
              <Input type="date" value={periodEnd} min={periodStart} onChange={e => setPeriodEnd(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Pay date</Label>
              <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-medium">Periods a year</Label>
              <Input
                type="number" min={1} max={366}
                value={periodsPerYear} onChange={e => setPeriodsPerYear(e.target.value)}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                12 monthly, 52 weekly. Annualised tax bands are divided by it, so it is not decoration.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Ruleset</Label>
            <Select value={rulesetId} onValueChange={setRulesetId}>
              <SelectTrigger>
                <SelectValue placeholder={rulesets.length ? 'Choose one' : 'No active rulesets'} />
              </SelectTrigger>
              <SelectContent>
                {rulesets.map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} · {r.countryCode}
                    {r.isStatutoryComplete ? '' : ' (uncertified)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {chosen ? <Verdict verdict={chosen.verdict} /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Compensation                                                              */
/* -------------------------------------------------------------------------- */

function Compensation() {
  const [records, setRecords] = React.useState<CompensationRecord[]>([]);
  const [people, setPeople] = React.useState<Person[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [recording, setRecording] = React.useState<Person | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([
        getList<CompensationRecord>('/api/hr/compensation?current=true'),
        getList<Person>('/api/hr/people?pageSize=200'),
      ]);
      setRecords(r.data);
      setPeople(p.data);
    } catch (e: any) {
      toast.error(e.message || 'Could not load compensation');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  if (loading) return <Card><Skeleton rows={5} /></Card>;

  const byMember = new Map(records.map(r => [r.memberId, r]));
  const uncovered = people.filter(p => !byMember.has(p.memberId) && p.lifecycleStage !== 'former');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 divide-x divide-border rounded-xl border border-border bg-card sm:grid-cols-3">
        <Stat label="On record" value={records.length} />
        <Stat
          label="No pay recorded"
          value={uncovered.length}
          tone={uncovered.length ? 'warning' : 'default'}
        />
        <Stat label="People" value={people.length} />
      </div>

      <Card>
        <div className="px-4 pt-3.5">
          <Head title="Current compensation" count={records.length} />
        </div>
        {records.length ? (
          <div className="mt-2.5 px-2 pb-2">
            <THead columns="grid-cols-[minmax(0,1.6fr)_auto_auto]">
              <span>Person</span>
              <span className="text-right">Base</span>
              <span className="text-right">Since</span>
            </THead>
            {records.map(r => (
              <TRow key={r.id} columns="grid-cols-[minmax(0,1.6fr)_auto_auto]">
                <PersonCell
                  id={r.member?.id ?? r.memberId}
                  name={r.member?.profiles?.fullName}
                  avatarUrl={r.member?.profiles?.avatarUrl}
                  secondary={labelOf(COMP_REASON_LABELS, r.changeReason)}
                />
                <span className="text-right text-[12.5px] font-medium tabular-nums text-foreground">
                  {money(r.baseAmount, r.currency)}
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                    {PAY_PERIOD_LABELS[r.payPeriod]}
                  </span>
                </span>
                <span className="text-right text-[11.5px] tabular-nums text-muted-foreground">
                  {day(r.effectiveFrom)}
                </span>
              </TRow>
            ))}
          </div>
        ) : (
          <Blank
            title="No compensation recorded"
            note="Effective-dated: a pay rise is a new record from a date, and the one it supersedes is closed rather than edited. That is what makes “what was she earning in March” answerable."
          />
        )}
      </Card>

      {uncovered.length ? (
        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Nobody has recorded their pay" count={uncovered.length} />
          </div>
          <p className="px-4 pt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            These people are excluded from every pay run until a record exists, and the run
            reports them rather than paying them zero.
          </p>
          <ul className="mt-2 divide-y divide-border">
            {uncovered.slice(0, 12).map(p => (
              <li key={p.memberId} className="flex items-center justify-between gap-3 px-4 py-2">
                <PersonCell
                  id={p.memberId} name={p.fullName} avatarUrl={p.avatarUrl}
                  secondary={p.jobTitle ?? p.departmentName}
                />
                <Button
                  size="sm" variant="outline" className="h-7 text-[12px]"
                  onClick={() => setRecording(p)}
                >
                  Record pay
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {recording ? (
        <CompensationDialog
          person={recording}
          currency={records[0]?.currency ?? 'NGN'}
          open
          onClose={() => setRecording(null)}
          onSaved={() => { setRecording(null); load(); }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Rulesets                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The payroll rules, and the honesty flag that governs them.
 *
 * A ruleset is an ordered list of declarative steps, and no jurisdiction's
 * arithmetic is compiled into this product - which is the only reason payroll
 * here can be used outside one country. The screen shows the steps in the
 * order they run, because the order is what makes "tax on pay after pension"
 * expressible.
 */
function Rulesets() {
  const [rulesets, setRulesets] = React.useState<Ruleset[]>([]);
  const [starters, setStarters] = React.useState<StarterRulesetOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [certifying, setCertifying] = React.useState<Ruleset | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const d = await getOne<{ rulesets: Ruleset[]; starters: StarterRulesetOption[] }>(
        '/api/hr/payroll/rulesets',
      );
      setRulesets(d.rulesets ?? []);
      setStarters(d.starters ?? []);
    } catch (e: any) {
      toast.error(e.message || 'Could not load the rules');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  if (loading) return <Card><Skeleton rows={4} /></Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
          A ruleset is how pay is calculated where you operate: an ordered list of steps,
          each over a named basis. No country&rsquo;s rules are built into this product, which
          is what lets a second one be added without a deployment.
        </p>
        <Button size="sm" className="h-8 shrink-0 text-[12.5px]" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 size-3.5" />
          New ruleset
        </Button>
      </div>

      {rulesets.length ? (
        <div className="space-y-4">
          {rulesets.map(r => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[14px] font-semibold text-foreground">{r.name}</h3>
                    <Pill tone="quiet">{r.countryCode}</Pill>
                    {!r.isActive ? <Pill tone="quiet">Inactive</Pill> : null}
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {r.rules?.steps?.length ?? 0} step
                    {(r.rules?.steps?.length ?? 0) === 1 ? '' : 's'} · {r.currency}
                  </p>
                </div>

                {!r.isStatutoryComplete ? (
                  <Button
                    size="sm" variant="outline" className="h-7 text-[12px]"
                    onClick={() => setCertifying(r)}
                  >
                    <ShieldCheck className="mr-1.5 size-3.5" />
                    Confirm the rules
                  </Button>
                ) : null}
              </div>

              <div className="px-4 py-3">
                <Verdict verdict={r.verdict} />
              </div>

              {r.rules?.steps?.length ? (
                <ol className="divide-y divide-border border-t border-border">
                  {r.rules.steps.map((s, i) => (
                    <li key={s.code} className="flex items-start gap-3 px-4 py-2.5">
                      <span className="mt-0.5 w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-medium text-foreground">
                          {s.label}
                        </span>
                        <span className="block text-[11.5px] text-muted-foreground">
                          {describeStep(s)}
                        </span>
                      </span>
                      <Pill tone={
                        s.kind === 'deduction' ? 'warn'
                          : s.kind === 'employer_cost' ? 'quiet' : 'accent'
                      }>
                        {s.kind === 'employer_cost' ? 'employer' : s.kind}
                      </Pill>
                    </li>
                  ))}
                </ol>
              ) : (
                <Blank title="No steps" note="This ruleset applies no deductions, so net pay equals gross." />
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <Blank
            title="No payroll rules"
            note="Without one, a pay run computes gross pay and applies no deductions — which it says on its face rather than implying the arithmetic is complete."
            action={<Button size="sm" onClick={() => setCreating(true)}>Create one</Button>}
          />
        </Card>
      )}

      {creating ? (
        <RulesetDialog
          starters={starters}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      ) : null}

      {certifying ? (
        <CertifyDialog
          ruleset={certifying}
          onClose={() => setCertifying(null)}
          onSaved={() => { setCertifying(null); load(); }}
        />
      ) : null}
    </div>
  );
}

/** A step, in a sentence. The JSON is precise and unreadable at a glance. */
function describeStep(s: Ruleset['rules']['steps'][number]): string {
  const basis =
    s.basis === 'base' ? 'base pay'
      : s.basis === 'taxable_gross' ? 'taxable pay'
        : s.basis === 'net_so_far' ? 'pay after earlier deductions'
          : s.basis === 'gross' || !s.basis ? 'gross pay'
            : s.basis;

  if (s.method === 'fixed') return `A fixed ${s.amount ?? 0}`;
  if (s.method === 'percent') return `${((s.rate ?? 0) * 100).toFixed(2)}% of ${basis}`;

  const bands = s.bands?.length ?? 0;
  const relief = s.reliefs?.length ? ', after relief' : '';
  return `${bands} band${bands === 1 ? '' : 's'} on ${s.annualise ? 'annualised ' : ''}${basis}${relief}`;
}

function RulesetDialog({
  starters,
  onClose,
  onSaved,
}: {
  starters: StarterRulesetOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [starter, setStarter] = React.useState('');
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const chosen = starters.find(s => s.key === starter);

  React.useEffect(() => { if (chosen) setName(chosen.name); }, [chosen]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error('Give it a name'); return; }
    setBusy(true);
    try {
      await post('/api/hr/payroll/rulesets', {
        starter: starter || undefined,
        name: name.trim(),
        country_code: chosen?.countryCode,
      });
      toast.success('Ruleset created — check the rates before confirming them');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not create the ruleset');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New payroll ruleset</DialogTitle>
          <DialogDescription>
            A starting point, not legal advice. Whatever you choose is created
            uncertified, and stays that way until somebody checks the numbers.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Start from</Label>
            <Select value={starter} onValueChange={setStarter}>
              <SelectTrigger><SelectValue placeholder="An empty ruleset" /></SelectTrigger>
              <SelectContent>
                {starters.map(s => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.name} · {s.countryCode} ({s.stepCount} steps)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chosen ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">{chosen.note}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nigeria PAYE" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Confirming that a ruleset is the full statutory rules.
 *
 * The one control in HR that changes what a screen is allowed to claim, so it
 * asks for something in return: a note saying against what. The endpoint
 * refuses without at least ten characters of it, and this says why rather than
 * surfacing a validation error.
 */
function CertifyDialog({
  ruleset,
  onClose,
  onSaved,
}: {
  ruleset: Ruleset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = React.useState(ruleset.statutoryNote ?? '');
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await patch(`/api/hr/payroll/rulesets/${ruleset.id}`, {
        is_statutory_complete: true,
        statutory_note: note.trim(),
      });
      toast.success('Confirmed');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Could not confirm the ruleset');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm these are the statutory rules</DialogTitle>
          <DialogDescription>
            After this, payroll figures calculated with {ruleset.name} are shown without
            a caveat. Only do it if you have checked the rates against the authority.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-medium">Checked against</Label>
            <Textarea
              value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="Finance Act 2023, PAYE bands as published in the FIRS circular of January 2026."
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              This sentence is shown beside every figure the ruleset produces. Rates change
              with a budget; a note nobody can point at is not a confirmation.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || note.trim().length < 10}>
              {busy ? 'Confirming…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Payslips                                                                  */
/* -------------------------------------------------------------------------- */

function Payslips({ selfMemberId }: { selfMemberId: string }) {
  const [items, setItems] = React.useState<PayrollItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState<PayrollItem | null>(null);

  React.useEffect(() => {
    getList<PayrollItem>('/api/hr/payroll/payslips')
      .then(r => setItems(r.data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Card><Skeleton rows={4} /></Card>;

  return (
    <Card>
      <div className="px-4 pt-3.5">
        <Head title="Your payslips" count={items.length || undefined} />
      </div>
      {items.length ? (
        <div className="mt-2.5 px-2 pb-2">
          <THead columns="grid-cols-[minmax(0,1.5fr)_auto_auto]">
            <span>Period</span>
            <span className="text-right">Gross</span>
            <span className="text-right">Net</span>
          </THead>
          {items.map(i => (
            <TRow
              key={i.id}
              columns="grid-cols-[minmax(0,1.5fr)_auto_auto]"
              onClick={() => setOpen(i)}
              ariaLabel={`Open payslip for ${i.period?.name}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-foreground">
                  {i.period?.name}
                </span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  Paid {day(i.period?.payDate)}
                </span>
              </span>
              <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                {money(i.gross, i.currency)}
              </span>
              <span className="text-right text-[12.5px] font-semibold tabular-nums text-foreground">
                {money(i.net, i.currency)}
              </span>
            </TRow>
          ))}
        </div>
      ) : (
        <Blank
          title="No payslips yet"
          note="A payslip becomes yours the day the run is marked paid, and not before — a draft run is a working document in which a figure may be wrong for an afternoon."
        />
      )}

      {open ? <PayslipDialog item={open} onClose={() => setOpen(null)} /> : null}
    </Card>
  );
}
