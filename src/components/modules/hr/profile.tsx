'use client';

import * as React from 'react';
import {
  ArrowLeft, Briefcase, CalendarDays, Clock, FileText, GitBranch,
  Target, Wallet, Users, FolderKanban, MessageSquareWarning, Plus,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, Head, Stat, Meter, Bar, THead, TRow } from '@/components/shared/readout/primitives';
import { Button } from '@/components/ui/button';
import { PersonAvatar } from '@/components/shared/person-avatar';
import { PresenceDot, PresenceLabel } from '@/components/shared/presence-dot';
import { useAppStore } from '@/store/app-store';
import { statusLabel } from '@/lib/constants';
import {
  EVENT_LABELS, EMPLOYMENT_TYPE_LABELS, DOCUMENT_CATEGORY_LABELS,
  CASE_CATEGORY_LABELS, COMP_REASON_LABELS, PAY_PERIOD_LABELS,
  labelOf, tenureLabel,
} from '@/lib/hr';
import { roleLabel, normalizeRole } from '@/lib/permissions';

import { getOne, money, duration, pct, whenWord } from './data';
import {
  PersonCell, StagePill, Field, Blank, Skeleton, Pill, Restricted, day, eventLine,
} from './ui';
import type { Profile360 } from './types';
import { EmploymentChangeDialog } from './forms';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Employee 360
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One person, and everything the rest of the Business OS knows about them.
 * There was no such screen: the module this replaces had an Edit dialogue on a
 * table row, which set role and department and nothing else.
 *
 * ── The composition ──────────────────────────────────────────────────────
 *
 *   header     who they are, where they sit, and the one action HR takes here
 *   summary    the employment facts, in a row that reads left to right
 *   panels     attendance · leave · work · performance · documents · journey
 *   history    the employment record, which is the reason 0039 exists
 *
 * ── Why the panels are not tabs ──────────────────────────────────────────
 *
 * A profile answers "who is this person", and a tab bar makes the reader ask
 * six questions one at a time to get there. The panels are short by design -
 * five leave rows, ten attendance days, the current salary and its last change
 * - and each links to the module that owns the detail. A tab that shows a
 * hundred attendance records is the attendance screen with a worse filter.
 *
 * ── What is absent, and why that is visible ──────────────────────────────
 *
 * `compensation` is missing from the payload entirely for a caller who may not
 * see it, rather than arriving empty. The difference matters: an empty panel
 * captioned "no salary recorded" for somebody who is in fact paid is a lie,
 * and `Restricted` says which of the two kinds of absence this is.
 */

export function EmployeeProfile({
  memberId,
  onBack,
  onOpenPerson,
}: {
  memberId: string;
  onBack: () => void;
  onOpenPerson: (id: string) => void;
}) {
  const [data, setData] = React.useState<Profile360 | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [changing, setChanging] = React.useState(false);

  /**
   * Opening a record in the module that owns it.
   *
   * A single selector, not an object: a Zustand v5 selector that builds one
   * returns a new reference on every store change and re-renders for ever,
   * which reads as "the module will not render" and is caught by no harness.
   */
  const openRecord = useAppStore(s => s.openRecord);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setData(await getOne<Profile360>(`/api/hr/people/${memberId}`));
    } catch (e: any) {
      toast.error(e.message || 'Could not load this profile');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  React.useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><Skeleton rows={4} /></Card>
          <Card><Skeleton rows={4} /></Card>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <Blank
          title="This profile is not available"
          note="Either the person does not exist, or you do not have access to their records. Those look the same on purpose."
          action={<Button size="sm" variant="outline" onClick={onBack}>Back to People</Button>}
        />
      </Card>
    );
  }

  const p = data.person;
  const comp = data.compensation;
  const journey = data.journeys.find(j => j.status === 'active');
  const att = data.attendance.summary;

  return (
    <div className="nm-enter space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        People
      </button>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 p-4 md:p-5">
          <div className="flex min-w-0 items-start gap-3.5">
            <PersonAvatar
              id={p.memberId} name={p.fullName} src={p.avatarUrl} size="lg" decorative
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[19px] font-semibold tracking-[-0.02em] text-foreground">
                  {p.fullName}
                </h2>
                <StagePill stage={p.lifecycleStage} />
                {p.status === 'suspended' ? <Pill tone="warn">Suspended</Pill> : null}
              </div>
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                {[p.jobTitle, p.departmentName].filter(Boolean).join(' · ') || 'No title recorded'}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <PresenceDot presence={p.presence} lastSeenAt={p.lastSeenAt} />
                  <PresenceLabel presence={p.presence} lastSeenAt={p.lastSeenAt} />
                </span>
                <a href={`mailto:${p.email}`} className="truncate hover:text-foreground hover:underline">
                  {p.email}
                </a>
                {p.phone ? <span>{p.phone}</span> : null}
              </div>
            </div>
          </div>

          {data.viewer.isHr ? (
            <Button size="sm" className="h-8 text-[12.5px]" onClick={() => setChanging(true)}>
              Record a change
            </Button>
          ) : null}
        </div>

        {/* The employment facts. A row rather than a definition list, because
            the reader is comparing them against another person's, not reading
            them as prose. */}
        <div className="grid grid-cols-2 gap-y-3 border-t border-border px-4 py-3.5 sm:grid-cols-3 md:px-5 lg:grid-cols-6">
          <Field label="Started" value={day(p.hiredOn ?? p.joinedAt?.slice(0, 10))}
                 hint={tenureLabel(p.tenureMonths)} />
          <Field label="Employment" value={labelOf(EMPLOYMENT_TYPE_LABELS, p.employmentType)} />
          <Field label="Access role" value={roleLabel(normalizeRole(p.role))} />
          <Field
            label="Reports to"
            value={p.managerName
              ? (
                <button
                  type="button"
                  onClick={() => p.managerId && onOpenPerson(p.managerId)}
                  className="truncate text-left hover:underline"
                >
                  {p.managerName}
                </button>
              )
              : 'Nobody'}
          />
          <Field
            label="Probation"
            value={p.probationEndsOn ? day(p.probationEndsOn) : '—'}
            hint={p.probationEndsOn ? `ends ${whenWord(p.probationEndsOn)}` : undefined}
          />
          <Field label="Location" value={p.workLocation ?? '—'} hint={p.employeeNumber ?? undefined} />
        </div>

        {/* Where they came from, when recruitment knows. */}
        {data.origin?.applications?.length ? (
          <div className="border-t border-border px-4 py-2.5 md:px-5">
            <p className="text-[12px] text-muted-foreground">
              Hired from{' '}
              <span className="font-medium text-foreground">
                {data.origin.applications[0].opening?.title}
              </span>
              {data.origin.applications[0].opening?.reference
                ? ` (${data.origin.applications[0].opening.reference})` : ''}
              {' · applied '}{whenWord(data.origin.applications[0].appliedOn)}
            </p>
          </div>
        ) : null}
      </Card>

      {/* ── Onboarding or offboarding in flight ─────────────────────────── */}
      {journey ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3.5">
            <Head
              title={journey.kind === 'onboarding' ? 'Onboarding' : 'Offboarding'}
              count={`${journey.progress?.done ?? 0}/${journey.progress?.total ?? 0}`}
              note={journey.progress?.overdue ? `${journey.progress.overdue} overdue` : undefined}
            />
            <span className="text-[12px] text-muted-foreground">
              Anchored on {day(journey.anchorDate)}
            </span>
          </div>
          <div className="px-4 pb-1 pt-2.5">
            <Meter
              value={journey.progress?.percent ?? 0}
              tone={journey.progress?.overdue ? 'warning' : 'accent'}
            />
          </div>
          <ul className="divide-y divide-border px-4 py-2">
            {(journey.items ?? []).slice(0, 6).map(item => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px]',
                      item.isDone
                        ? 'border-success bg-success/15 text-success'
                        : 'border-border text-transparent',
                    )}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <span className={cn(
                    'truncate text-[12.5px]',
                    item.isDone ? 'text-muted-foreground line-through' : 'text-foreground',
                  )}>
                    {item.title}
                  </span>
                </span>
                <span className="shrink-0 text-[11.5px] text-muted-foreground">
                  {item.assignee?.profiles?.fullName ?? 'Unassigned'}
                  {item.dueOn ? ` · ${whenWord(item.dueOn)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ── Attendance and leave ────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Attendance" note="last 90 days" />
          </div>
          {att.days ? (
            <>
              <div className="mt-3 grid grid-cols-3 divide-x divide-y divide-border border-y border-border sm:grid-cols-4 sm:divide-y-0">
                <Stat label="Days recorded" value={att.days} />
                <Stat label="Average day" value={duration(att.averageMinutes)} />
                <Stat
                  label="On time"
                  value={att.punctualityRate === null ? '—' : `${att.punctualityRate}%`}
                  tone={att.punctualityRate !== null && att.punctualityRate < 80 ? 'warning' : 'default'}
                />
                <Stat label="Remote" value={att.remote} />
              </div>
              <div className="px-4 py-3">
                <Bar
                  segments={[
                    { value: att.present, tone: 'accent', title: 'Present' },
                    { value: att.remote, tone: 'claim', title: 'Remote' },
                    { value: att.onLeave, tone: 'quiet', title: 'On leave' },
                    { value: att.absent, tone: 'bad', title: 'Absent' },
                  ]}
                  height={5}
                />
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  {att.late
                    ? `${att.late} late arrival${att.late === 1 ? '' : 's'} in the window.`
                    : 'No late arrivals in the window.'}
                </p>
              </div>
            </>
          ) : (
            <Blank
              title="No attendance in the last 90 days"
              note="Records appear as they clock in and out. The server stamps the times, not the browser."
            />
          )}
        </Card>

        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Leave" count={data.leave.balances.length || undefined} />
          </div>
          {data.leave.balances.length ? (
            <ul className="space-y-2.5 px-4 py-3">
              {data.leave.balances.map(b => (
                <li key={b.type}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] text-foreground">{statusLabel(b.type)}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{b.remainingDays}</span>
                      {' '}of {b.totalDays} left
                    </span>
                  </div>
                  <Meter
                    value={b.totalDays ? ((b.totalDays - b.remainingDays) / b.totalDays) * 100 : 0}
                    className="mt-1.5"
                  />
                </li>
              ))}
            </ul>
          ) : (
            /* The balance table has existed since 0003 and had no writer until
               now; an organisation that has not set entitlements yet is the
               ordinary case rather than an error. */
            <Blank
              title="No entitlement set"
              note="Leave balances are set per person per year, in the Leave section. Until one exists this person's requests are approved without a balance to draw down."
            />
          )}

          {data.leave.requests.length ? (
            <ul className="divide-y divide-border border-t border-border">
              {data.leave.requests.slice(0, 4).map(r => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-foreground">
                      {statusLabel(r.type)}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {day(r.startDate)} – {day(r.endDate)}
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
          ) : null}
        </Card>
      </div>

      {/* ── Work and performance ────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Work" note="projects and open tasks" />
          </div>
          {data.work.projects.length || data.work.tasks.length ? (
            <div className="px-4 py-3">
              {data.work.projects.length ? (
                <ul className="space-y-2">
                  {data.work.projects.slice(0, 5).map((m, i) => (
                    <li key={m.project?.id ?? i} className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => m.project && openRecord('projects', 'project', m.project.id)}
                        className="min-w-0 truncate text-left text-[12.5px] text-foreground hover:underline"
                      >
                        {m.project?.name ?? 'A project'}
                      </button>
                      <span className="shrink-0 text-[11.5px] text-muted-foreground">
                        {m.role} · {m.allocationPct}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {data.work.tasks.length ? (
                <ul className={cn('space-y-1.5', data.work.projects.length && 'mt-3 border-t border-border pt-2.5')}>
                  {data.work.tasks.slice(0, 5).map(t => (
                    <li key={t.id} className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => openRecord('projects', 'task', t.id)}
                        className="min-w-0 truncate text-left text-[12.5px] text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {t.title}
                      </button>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {t.dueDate ? whenWord(t.dueDate) : statusLabel(t.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <Blank
              title="Not on any project"
              note="Project membership and assigned tasks appear here, and open in Projects."
            />
          )}
        </Card>

        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Performance" />
          </div>
          {data.performance.goals.length || data.performance.reviews.length ? (
            <div className="px-4 py-3">
              {data.performance.goals.length ? (
                <ul className="space-y-2.5">
                  {data.performance.goals.slice(0, 4).map(g => {
                    const progress = g.targetValue
                      ? Math.min(100, (Number(g.currentValue ?? 0) / Number(g.targetValue)) * 100)
                      : null;
                    return (
                      <li key={g.id}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-[12.5px] text-foreground">{g.title}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {/* A measured goal counts itself from the event
                                spine; an assessed one is judged at review, and
                                showing a progress bar for it would invent one. */}
                            {g.kind === 'measured' && progress !== null
                              ? pct(progress)
                              : statusLabel(g.status)}
                          </span>
                        </div>
                        {g.kind === 'measured' && progress !== null ? (
                          <Meter value={progress} className="mt-1.5" tone="brand" />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {data.performance.reviews.length ? (
                <ul className={cn('space-y-1.5', data.performance.goals.length && 'mt-3 border-t border-border pt-2.5')}>
                  {data.performance.reviews.slice(0, 3).map(r => (
                    <li key={r.id} className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="truncate text-muted-foreground">
                        {r.cycle?.name ?? 'Review'}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {r.overallRating ? `${r.overallRating}/5` : statusLabel(r.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <Blank
              title="No goals or reviews"
              note="Goals, review cycles and achievements live in Performance, and a measured goal counts itself from what actually happened."
            />
          )}
        </Card>
      </div>

      {/* ── Compensation ────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center justify-between px-4 pt-3.5">
          <Head title="Compensation" />
          {comp?.current ? (
            <span className="text-[11.5px] text-muted-foreground">
              Since {day(comp.current.effectiveFrom)}
            </span>
          ) : null}
        </div>

        {!data.viewer.canSeeCompensation || comp === undefined ? (
          /* The endpoint omitted the key entirely. Saying so is the difference
             between "you may not see this" and "there is nothing here". */
          <Restricted what="Pay is visible to HR and administrators, and to the person themselves." />
        ) : comp.current ? (
          <>
            <div className="grid grid-cols-2 gap-y-3 border-t border-border px-4 py-3.5 sm:grid-cols-4">
              <Field
                label="Base pay"
                value={money(comp.current.baseAmount, comp.current.currency)}
                hint={PAY_PERIOD_LABELS[comp.current.payPeriod]}
              />
              <Field
                label="Last change"
                value={labelOf(COMP_REASON_LABELS, comp.current.changeReason)}
                hint={whenWord(comp.current.effectiveFrom)}
              />
              <Field
                label="Allowances"
                value={comp.components.filter(c => c.kind === 'earning').length || '—'}
              />
              <Field
                label="Deductions"
                value={comp.components.filter(c => c.kind === 'deduction').length || '—'}
              />
            </div>

            {comp.records.length > 1 ? (
              <ul className="divide-y divide-border border-t border-border">
                {comp.records.slice(0, 5).map(r => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-foreground">
                        {money(r.baseAmount, r.currency)}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {labelOf(COMP_REASON_LABELS, r.changeReason)}
                        {r.note ? ` · ${r.note}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                      {day(r.effectiveFrom)}
                      {r.effectiveTo ? ` – ${day(r.effectiveTo)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <Blank
            title="No pay recorded"
            note="Until a compensation record exists this person is excluded from every pay run, and the run says so rather than paying them zero."
          />
        )}
      </Card>

      {/* ── Documents, reports and cases ────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Documents" count={data.documents.length || undefined} />
          </div>
          {data.documents.length ? (
            <ul className="divide-y divide-border">
              {data.documents.slice(0, 6).map(d => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-foreground">{d.filename}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {labelOf(DOCUMENT_CATEGORY_LABELS, d.hrCategory)} · {day(d.createdAt.slice(0, 10))}
                    </span>
                  </span>
                  {d.isConfidential ? <Pill>Confidential</Pill> : null}
                </li>
              ))}
            </ul>
          ) : (
            <Blank
              title="No documents"
              note="Contracts and identification are filed here, confidential by construction: visible to this person and to HR, and to nobody else."
            />
          )}
        </Card>

        <Card>
          <div className="px-4 pt-3.5">
            <Head title="Direct reports" count={data.reports.length || undefined} />
          </div>
          {data.reports.length ? (
            <ul className="divide-y divide-border">
              {data.reports.map(r => (
                <li key={r.memberId} className="flex items-center justify-between gap-3 px-4 py-2">
                  <PersonCell
                    id={r.memberId}
                    name={r.fullName}
                    avatarUrl={r.avatarUrl}
                    secondary={r.jobTitle ?? r.departmentName}
                    onClick={() => onOpenPerson(r.memberId)}
                  />
                  <StagePill stage={r.lifecycleStage} />
                </li>
              ))}
            </ul>
          ) : (
            <Blank title="No direct reports" note="Nobody currently reports to this person." />
          )}
        </Card>

        <Card>
          <div className="px-4 pt-3.5">
            <Head title="HR cases" count={data.cases.length || undefined} />
          </div>
          {data.cases.length ? (
            <ul className="divide-y divide-border">
              {data.cases.slice(0, 6).map(c => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-foreground">{c.subject}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {c.reference} · {labelOf(CASE_CATEGORY_LABELS, c.category)}
                    </span>
                  </span>
                  <Pill tone={c.status === 'resolved' || c.status === 'closed' ? 'good' : 'warn'}>
                    {statusLabel(c.status)}
                  </Pill>
                </li>
              ))}
            </ul>
          ) : (
            <Blank
              title="No cases"
              note="Cases raised about or by this person appear here. Restricted ones do not, even to their subject."
            />
          )}
        </Card>
      </div>

      {/* ── The employment record ───────────────────────────────────────── */}
      <Card>
        <div className="px-4 pt-3.5">
          <Head
            title="Employment record"
            count={data.history.length}
            note="append-only"
          />
        </div>
        {data.history.length ? (
          <ol className="px-4 py-3">
            {data.history.map((e, i) => (
              <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                {/* A rail down the left, so a list of dated facts reads as a
                    sequence rather than as rows. */}
                {i < data.history.length - 1 ? (
                  <span
                    className="absolute left-[5px] top-4 h-full w-px bg-border"
                    aria-hidden="true"
                  />
                ) : null}
                <span
                  className={cn(
                    'relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-card',
                    e.kind === 'hired' || e.kind === 'rehired' ? 'bg-[var(--chart-1)]'
                      : e.kind === 'offboarded' ? 'bg-warning'
                        : 'bg-muted-foreground/50',
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[12.5px] font-medium text-foreground">
                      {labelOf(EVENT_LABELS, e.kind)}
                    </span>
                    <span className="text-[11.5px] tabular-nums text-muted-foreground">
                      {day(e.effectiveOn)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                    {eventLine(e)}
                  </p>
                  {e.recorder?.profiles?.fullName ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                      Recorded by {e.recorder.profiles.fullName}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Blank title="No history" note="Every employment opens with a joining record." />
        )}
      </Card>

      {changing ? (
        <EmploymentChangeDialog
          person={p}
          open={changing}
          onClose={() => setChanging(false)}
          onSaved={() => { setChanging(false); load(); }}
        />
      ) : null}
    </div>
  );
}
