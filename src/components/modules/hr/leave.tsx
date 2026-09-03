'use client';

import * as React from 'react';
import { Plus, Check, X, CalendarRange } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, Head, Stat, Meter, THead, TRow } from '@/components/shared/readout/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/store/app-store';
import { useModuleRealtime } from '@/hooks/use-realtime';
import { LEAVE_TYPES, statusLabel } from '@/lib/constants';

import { getList, getOne, patch, whenWord, todayISO, shiftISO } from './data';
import { PersonCell, Blank, Skeleton, Pill, day } from './ui';
import { LeaveRequestDialog, LeaveBalanceDialog } from './forms';
import type { LeaveRow, LeaveBalance, Person } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Leave
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What changed, and what did not ───────────────────────────────────────
 *
 * The approval logic, the policy checks and the self-approval block are
 * untouched: `/api/hr/leave` and its `[id]` route already enforce the
 * organisation's notice period, its maximum span, its offered types and the
 * rule that nobody decides their own request. None of that moved.
 *
 * What changed is that the screen finally shows **the balance**.
 * `leave_balances` has existed since migration 0003 with entitlement, days
 * used and carry-over, and until this phase no endpoint read or wrote it - so
 * the request form asked somebody to book time off with no indication of
 * whether they had any, and HR had no way to say how much they were entitled
 * to.
 *
 * ── The three questions this screen answers ──────────────────────────────
 *
 *   mine        how much have I got left, and what have I booked
 *   pending     what is waiting on me to decide
 *   calendar    who else is away when I want to be
 *
 * The last one is the conflict awareness the brief asks for, and it is a real
 * read of approved leave rather than a warning generated from nothing.
 */

export function Leave({
  canApprove,
  canManage,
  selfMemberId,
}: {
  canApprove: boolean;
  canManage: boolean;
  selfMemberId: string;
}) {
  const [requests, setRequests] = React.useState<LeaveRow[]>([]);
  const [balances, setBalances] = React.useState<LeaveBalance[]>([]);
  const [people, setPeople] = React.useState<Person[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [requesting, setRequesting] = React.useState(false);
  const [settingBalance, setSettingBalance] = React.useState(false);
  const [deciding, setDeciding] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'mine' | 'pending' | 'calendar' | 'balances'>('mine');

  const policies = useAppStore(s => s.organization?.policies);

  const leavePolicy = (policies?.leavePolicy ?? {}) as {
    types?: string[]; allowHalfDay?: boolean;
    maxConsecutiveDays?: number; minNoticeDays?: number;
  };

  /**
   * What this company actually offers.
   *
   * `leave_policy.types` is what an administrator chose on the Workplace tab.
   * Falling back to the whole enum for an organisation whose policy row has
   * not been written yet: they must still be able to request leave.
   */
  const offeredTypes = React.useMemo(() => {
    const configured = (leavePolicy.types ?? []).filter(t =>
      (LEAVE_TYPES as readonly string[]).includes(t));
    return configured.length ? configured : [...LEAVE_TYPES];
  }, [leavePolicy.types]);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [r, b, p] = await Promise.all([
        getList<LeaveRow>('/api/hr/leave?pageSize=500'),
        getOne<{ year: number; balances: LeaveBalance[] }>('/api/hr/leave/balances'),
        canManage
          ? getList<Person>('/api/hr/people?pageSize=200')
          : Promise.resolve({ data: [] as Person[] }),
      ]);
      setRequests(r.data);
      setBalances(b.balances ?? []);
      setPeople(p.data);
    } catch (e: any) {
      if (!silent) toast.error(e.message || 'Could not load leave');
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  React.useEffect(() => { load(); }, [load]);

  /* A decision made by a colleague leaves this table, and the balance under it
     moves with it. */
  useModuleRealtime('hr-leave', ['leave_requests', 'leave_balances'], () => load(true));

  async function decide(id: string, status: 'approved' | 'rejected') {
    setDeciding(id);
    try {
      await patch(`/api/hr/leave/${id}`, { status });
      toast.success(status === 'approved' ? 'Leave approved' : 'Leave rejected');
      load(true);
    } catch (e: any) {
      /* "You cannot approve your own leave request" is the endpoint's wording
         and is better than anything this file could substitute. */
      toast.error(e.message || 'Could not record the decision');
    } finally {
      setDeciding(null);
    }
  }

  if (loading) return <Card><Skeleton rows={5} /></Card>;

  const today = todayISO();
  const mine = requests.filter(r => r.memberId === selfMemberId);
  const pending = requests.filter(r => r.status === 'pending');
  const myBalances = balances.filter(b => !b.memberId || b.memberId === selfMemberId);
  const upcoming = requests.filter(r => r.status === 'approved' && r.endDate >= today);

  const totalRemaining = myBalances.reduce((s, b) => s + b.remainingDays, 0);
  const totalEntitled = myBalances.reduce((s, b) => s + b.totalDays, 0);

  return (
    <div className="nm-enter space-y-4">
      <div className="grid grid-cols-2 divide-x divide-y divide-border rounded-xl border border-border bg-card sm:grid-cols-4 sm:divide-y-0">
        <Stat
          label="Your days left"
          value={myBalances.length ? totalRemaining : '—'}
        />
        <Stat label="Away today" value={requests.filter(r =>
          r.status === 'approved' && r.startDate <= today && r.endDate >= today).length} />
        <Stat
          label="Waiting on a decision"
          value={pending.length}
          tone={pending.length ? 'warning' : 'default'}
        />
        <Stat label="Booked ahead" value={upcoming.length} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {([
            ['mine', 'Mine'],
            ...(canApprove ? [['pending', `To decide${pending.length ? ` (${pending.length})` : ''}`] as const] : []),
            ['calendar', 'Who is away'],
            ...(canManage ? [['balances', 'Entitlements'] as const] : []),
          ] as const).map(([id, label]) => (
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

        <div className="ml-auto flex gap-2">
          {canManage && view === 'balances' ? (
            <Button size="sm" variant="outline" className="h-8 text-[12.5px]"
                    onClick={() => setSettingBalance(true)}>
              Set an entitlement
            </Button>
          ) : null}
          <Button size="sm" className="h-8 text-[12.5px]" onClick={() => setRequesting(true)}>
            <Plus className="mr-1.5 size-3.5" />
            Request leave
          </Button>
        </div>
      </div>

      {view === 'mine' ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <Card>
            <div className="px-4 pt-3.5">
              <Head title="Your balance" note={`${new Date().getFullYear()}`} />
            </div>
            {myBalances.length ? (
              <>
                <ul className="space-y-3 px-4 py-3">
                  {myBalances.map(b => (
                    <li key={b.type}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[12.5px] text-foreground">{statusLabel(b.type)}</span>
                        <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                          <span className="text-[14px] font-semibold text-foreground">
                            {b.remainingDays}
                          </span>
                          {' '}of {b.totalDays}
                        </span>
                      </div>
                      <Meter
                        value={b.totalDays ? ((b.totalDays - b.remainingDays) / b.totalDays) * 100 : 0}
                        className="mt-1.5"
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {b.usedDays} used
                        {b.carriedDays ? ` · ${b.carriedDays} carried over` : ''}
                        {/* Where the stored figure and the approved requests
                            disagree, the screen says so rather than picking
                            one. Two numbers that differ are a conversation. */}
                        {b.needsReconciliation
                          ? ` · approved leave adds up to ${b.impliedUsedDays}`
                          : ''}
                      </p>
                    </li>
                  ))}
                </ul>
                {myBalances.some(b => b.needsReconciliation) ? (
                  <p className="border-t border-border px-4 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
                    Where the recorded days used and the approved requests differ, both are
                    shown. HR decides which is right — the figure is not silently rewritten.
                  </p>
                ) : null}
              </>
            ) : (
              <Blank
                title="No entitlement set"
                note="Until HR records one, your requests are approved without a balance to draw down. Nothing is blocked; there is just nothing to count against."
              />
            )}
          </Card>

          <Card>
            <div className="px-4 pt-3.5">
              <Head title="Your leave" count={mine.length || undefined} />
            </div>
            {mine.length ? (
              <ul className="mt-1 divide-y divide-border">
                {mine.map(r => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">
                        {statusLabel(r.type)}
                      </span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">
                        {day(r.startDate)}
                        {r.startDate !== r.endDate ? ` – ${day(r.endDate)}` : ''}
                        {r.isHalfDay ? ' · half day' : ''}
                        {r.reason ? ` · ${r.reason}` : ''}
                      </span>
                    </span>
                    <Pill tone={
                      r.status === 'approved' ? 'good'
                        : r.status === 'pending' ? 'warn'
                          : r.status === 'rejected' ? 'bad' : 'quiet'
                    }>
                      {statusLabel(r.status)}
                    </Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <Blank title="No leave booked" note="Requesting leave sends it to whoever approves for you." />
            )}
          </Card>
        </div>
      ) : null}

      {view === 'pending' && canApprove ? (
        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Waiting on a decision" count={pending.length} />
          </div>
          {pending.length ? (
            <ul className="mt-1 divide-y divide-border">
              {pending.map(r => {
                const isOwn = r.memberId === selfMemberId;
                /* Anybody already away over the same dates. A real read, not a
                   warning generated from nothing. */
                const clashes = requests.filter(o =>
                  o.status === 'approved' &&
                  o.memberId !== r.memberId &&
                  o.startDate <= r.endDate && o.endDate >= r.startDate);

                return (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <PersonCell
                        id={r.member?.id ?? r.memberId}
                        name={r.member?.profiles?.fullName}
                        avatarUrl={r.member?.profiles?.avatarUrl}
                        secondary={`${statusLabel(r.type)} · ${day(r.startDate)}${
                          r.startDate !== r.endDate ? ` – ${day(r.endDate)}` : ''
                        }${r.isHalfDay ? ' · half day' : ''}`}
                      />

                      <div className="flex shrink-0 items-center gap-1.5">
                        {isOwn ? (
                          /* Said before the button is pressed rather than after
                             the endpoint refuses. */
                          <span className="text-[11.5px] text-muted-foreground">
                            Your own — somebody else decides
                          </span>
                        ) : (
                          <>
                            <Button
                              size="sm" variant="outline" className="h-7 text-[12px]"
                              disabled={deciding === r.id}
                              onClick={() => decide(r.id, 'rejected')}
                            >
                              <X className="mr-1 size-3" />
                              Reject
                            </Button>
                            <Button
                              size="sm" className="h-7 text-[12px]"
                              disabled={deciding === r.id}
                              onClick={() => decide(r.id, 'approved')}
                            >
                              <Check className="mr-1 size-3" />
                              Approve
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {r.reason ? (
                      <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                        {r.reason}
                      </p>
                    ) : null}

                    {clashes.length ? (
                      <p className="mt-1.5 text-[11.5px] text-warning">
                        {clashes.length} colleague{clashes.length === 1 ? ' is' : 's are'} already
                        away over these dates:{' '}
                        {clashes.slice(0, 3)
                          .map(c => c.member?.profiles?.fullName)
                          .filter(Boolean).join(', ')}
                        {clashes.length > 3 ? ` and ${clashes.length - 3} more` : ''}.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Blank title="Nothing waiting" note="Requests appear here when somebody you approve for files one." />
          )}
        </Card>
      ) : null}

      {view === 'calendar' ? (
        <AwayCalendar requests={requests.filter(r => r.status === 'approved')} />
      ) : null}

      {view === 'balances' && canManage ? (
        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Entitlements" count={balances.length} note={String(new Date().getFullYear())} />
          </div>
          {balances.length ? (
            <div className="mt-2.5 px-2 pb-2">
              <THead columns="grid-cols-[minmax(0,1.6fr)_auto_auto_auto]">
                <span>Person</span>
                <span className="text-right">Entitled</span>
                <span className="text-right">Used</span>
                <span className="text-right">Left</span>
              </THead>
              {balances.map(b => (
                <TRow
                  key={`${b.memberId}-${b.type}`}
                  columns="grid-cols-[minmax(0,1.6fr)_auto_auto_auto]"
                >
                  <PersonCell
                    id={b.member?.id ?? b.memberId ?? b.type}
                    name={b.member?.profiles?.fullName ?? 'You'}
                    avatarUrl={b.member?.profiles?.avatarUrl}
                    secondary={statusLabel(b.type)}
                  />
                  <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                    {b.totalDays}
                  </span>
                  <span className={cn(
                    'text-right text-[12.5px] tabular-nums',
                    b.needsReconciliation ? 'text-warning' : 'text-muted-foreground',
                  )}>
                    {b.usedDays}
                    {b.needsReconciliation ? ` (${b.impliedUsedDays})` : ''}
                  </span>
                  <span className="text-right text-[12.5px] font-semibold tabular-nums text-foreground">
                    {b.remainingDays}
                  </span>
                </TRow>
              ))}
            </div>
          ) : (
            <Blank
              title="No entitlements set"
              note="One record per person, per leave type, per year. Nothing is blocked without one — there is simply no balance to count against."
              action={<Button size="sm" onClick={() => setSettingBalance(true)}>Set one</Button>}
            />
          )}
        </Card>
      ) : null}

      {requesting ? (
        <LeaveRequestDialog
          open
          onClose={() => setRequesting(false)}
          onSaved={() => { setRequesting(false); load(); }}
          offeredTypes={offeredTypes}
          allowHalfDay={leavePolicy.allowHalfDay !== false}
          people={people}
          canFileForOthers={canManage}
          selfMemberId={selfMemberId}
        />
      ) : null}

      {settingBalance ? (
        <LeaveBalanceDialog
          open
          people={people}
          onClose={() => setSettingBalance(false)}
          onSaved={() => { setSettingBalance(false); load(); }}
        />
      ) : null}
    </div>
  );
}

/**
 * Who is away, over the next eight weeks.
 *
 * A row per person and a column per week, rather than a month grid: the
 * question is "can I take the 14th" and the answer is whether the bars either
 * side of it are crowded. A calendar month with dots in it takes twelve
 * glances to answer the same thing.
 */
function AwayCalendar({ requests }: { requests: LeaveRow[] }) {
  const today = todayISO();
  const horizon = shiftISO(today, 56);

  const inWindow = requests.filter(r => r.endDate >= today && r.startDate <= horizon);

  const byPerson = React.useMemo(() => {
    const map = new Map<string, { name: string; avatarUrl: string | null; rows: LeaveRow[] }>();
    for (const r of inWindow) {
      const id = r.member?.id ?? r.memberId;
      const held = map.get(id);
      if (held) held.rows.push(r);
      else map.set(id, {
        name: r.member?.profiles?.fullName ?? 'Someone',
        avatarUrl: r.member?.profiles?.avatarUrl ?? null,
        rows: [r],
      });
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [inWindow]);

  const days = 56;
  const start = Date.parse(`${today}T00:00:00Z`);
  const offsetOf = (iso: string) =>
    Math.round((Date.parse(`${iso}T00:00:00Z`) - start) / 86_400_000);

  return (
    <Card>
      <div className="px-4 pt-3.5">
        <Head title="Who is away" count={byPerson.length || undefined} note="next eight weeks" />
      </div>

      {byPerson.length ? (
        <div className="overflow-x-auto px-4 py-3">
          <div className="min-w-[560px]">
            {/* Week markers, so a bar can be read against a date rather than
                against nothing. */}
            <div className="relative mb-1.5 ml-[168px] h-4">
              {Array.from({ length: 8 }).map((_, w) => (
                <span
                  key={w}
                  className="absolute top-0 text-[10.5px] tabular-nums text-muted-foreground"
                  style={{ left: `${(w * 7 / days) * 100}%` }}
                >
                  {day(shiftISO(today, w * 7))}
                </span>
              ))}
            </div>

            <ul className="space-y-1.5">
              {byPerson.map(([id, person]) => (
                <li key={id} className="flex items-center gap-3">
                  <span className="w-[156px] shrink-0">
                    <PersonCell id={id} name={person.name} avatarUrl={person.avatarUrl} size="xs" />
                  </span>
                  <span className="relative h-5 flex-1 rounded bg-muted/60">
                    {person.rows.map(r => {
                      const from = Math.max(0, offsetOf(r.startDate));
                      const to = Math.min(days, offsetOf(r.endDate) + 1);
                      if (to <= from) return null;
                      return (
                        <span
                          key={r.id}
                          title={`${statusLabel(r.type)} · ${day(r.startDate)} – ${day(r.endDate)}`}
                          className="absolute inset-y-0 rounded bg-[var(--chart-1)]/70"
                          style={{
                            left: `${(from / days) * 100}%`,
                            width: `${((to - from) / days) * 100}%`,
                          }}
                        />
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <Blank
          title="Nobody is away"
          note="Approved leave over the next eight weeks appears here, so a request can be judged against who else is out."
        />
      )}
    </Card>
  );
}
