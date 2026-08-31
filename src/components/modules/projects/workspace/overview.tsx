'use client';

import * as React from 'react';
import { Ban, AlertTriangle, ArrowRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Head, Bar, Rail } from '@/components/shared/readout/primitives';
import { formatDay, relativeDay, daysUntil, todayISO } from '@/lib/format';

import { exact, pct, hours } from '../data';
import {
  ProgressBreakdown, PersonChip, DueDate, StageTag, TaskStatusTag, Nothing, Figure,
} from '../ui';
import { TASK_STATUS_LABELS, type Workspace } from '../types';
import { LinkedDocuments } from '@/components/shared/linked-documents';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Overview - the project's command centre
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The question it answers, in order ────────────────────────────────────
 *
 *   What is in the way        blockers and risks, derived from the work itself
 *   What is happening now     the work, by state, and what is next
 *   What is the client owed   deliverables and their decisions
 *   What does progress mean   the three components behind the one number
 *   What comes next           the nearest phases
 *   What has it cost          invoiced against budget, where the reader may see it
 *
 * ── Derived, never entered ───────────────────────────────────────────────
 *
 * There is no risk register anybody maintains. A register somebody has to keep
 * up to date goes stale in a fortnight and then actively misleads; these are
 * computed by the endpoint from the rows themselves, so they are true whenever
 * anybody looks. A blocked task is a blocker because somebody set it blocked,
 * an overdue phase is a risk because the date passed, and a task waiting on an
 * unfinished dependency is a blocker whether or not anyone remembered to say
 * so.
 */

type Panel = 'overview' | 'roadmap' | 'team' | 'timeline' | 'files' | 'discussion';

export function OverviewPanel({
  data, onGoPanel, onNewTask,
}: {
  data: Workspace;
  onGoPanel: (panel: Panel) => void;
  onNewTask: () => void;
}) {
  const { health, project, blockers, risks, milestones, tasks, deliverables, finance } = data;
  const today = todayISO();

  const byStatus = React.useMemo(() => {
    const counts: Record<string, number> = { todo: 0, in_progress: 0, review: 0, blocked: 0, done: 0 };
    for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
    return counts;
  }, [tasks]);

  /**
   * What is being worked on right now.
   *
   * In progress and in review, soonest deadline first, undated last. Not "the
   * next five tasks by sort order" - a plan's ordering says what should happen
   * eventually, and this region is about what is happening today.
   */
  const inFlight = React.useMemo(
    () => tasks
      .filter(t => t.status === 'in_progress' || t.status === 'review')
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
      .slice(0, 6),
    [tasks],
  );

  const upcoming = React.useMemo(
    () => milestones.filter(m => !m.completedAt).slice(0, 4),
    [milestones],
  );

  const openDeliverables = React.useMemo(
    () => data.files
      .filter(f => f.requiresApproval)
      .sort((a, b) => {
        // Rejected first, then still waiting, then accepted: the order they
        // need somebody's attention in.
        const rank = (d: string | null) => (d === 'rejected' ? 0 : d === null ? 1 : 2);
        return rank(a.approvalDecision) - rank(b.approvalDecision);
      })
      .slice(0, 5),
    [data.files],
  );

  const invoiced = finance?.invoices.reduce((n, i) => n + Number(i.total), 0) ?? 0;
  const collected = finance?.invoices.reduce((n, i) => n + Number(i.amountPaid), 0) ?? 0;
  const spent = finance?.expenses
    .filter(e => e.status === 'approved' || e.status === 'reimbursed')
    .reduce((n, e) => n + Number(e.amount), 0) ?? 0;

  const openTasks = tasks.length - byStatus.done;

  return (
    <div className="flex flex-col gap-6">
      {/* ── In the way ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Head
          title="In the way"
          count={blockers.length + risks.length}
          note="Derived from the work, not entered by hand"
        />
        {blockers.length + risks.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-4 shadow-e1">
            <Nothing
              className="py-1"
              title="Nothing is blocked or overdue"
              note="No blocked tasks, no late phases, and everything open has somebody's name on it."
            />
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-1.5 shadow-e1">
            {[...blockers, ...risks].slice(0, 10).map((r, i) => {
              const critical = r.kind === 'blocked_task'
                || r.kind === 'past_end_date'
                || r.kind === 'overdue_milestone'
                || r.kind === 'rejected_deliverable';
              return (
                <div
                  key={`${r.kind}-${r.id}-${i}`}
                  className="relative grid grid-cols-[auto_1fr] items-start gap-x-3 rounded-md py-2.5 pl-4 pr-3"
                >
                  <Rail severity={critical ? 'critical' : 'warning'} />
                  {critical
                    ? <Ban className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                    : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />}
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground">{r.title}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {r.detail}{r.owner && ` · ${r.owner}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* ── Left: the work ───────────────────────────────────────────── */}
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <Head
              title="Work"
              count={tasks.length}
              note={`${openTasks} open`}
              action={{ label: 'Roadmap', onClick: () => onGoPanel('roadmap') }}
            />

            <div className="rounded-xl border border-border bg-card p-4 shadow-e1">
              {tasks.length === 0 ? (
                <Nothing
                  className="py-1"
                  title="No tasks yet"
                  note="Break the project down so progress can be measured against something."
                  action={<Button size="sm" onClick={onNewTask}>Raise a task</Button>}
                />
              ) : (
                <>
                  {/*
                    The composition of the work.

                    Five states, one bar, and every task is in exactly one of
                    them - so the segments sum to the count in the heading. The
                    legend under it doubles as the figures, which is why there
                    is no separate row of five statistics.
                  */}
                  <Bar
                    height={6}
                    segments={[
                      { value: byStatus.done, tone: 'accent', title: 'Done' },
                      { value: byStatus.review, tone: 'claim', title: 'In review' },
                      { value: byStatus.in_progress, tone: 'quiet', title: 'In progress' },
                      { value: byStatus.todo, tone: 'quiet', title: 'To do' },
                      { value: byStatus.blocked, tone: 'bad', title: 'Blocked' },
                    ]}
                  />
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                    {(['done', 'in_progress', 'review', 'todo', 'blocked'] as const).map(s => (
                      <span key={s} className="inline-flex items-baseline gap-1.5 text-[12px] text-muted-foreground">
                        <span className={cn(
                          'text-[13.5px] font-semibold tabular-nums',
                          s === 'blocked' && byStatus.blocked > 0 ? 'text-destructive' : 'text-foreground',
                        )}>
                          {byStatus[s]}
                        </span>
                        {TASK_STATUS_LABELS[s]}
                      </span>
                    ))}
                  </div>

                  {Number(health?.loggedHours ?? 0) > 0 && (
                    <p className="mt-3 border-t border-border/70 pt-3 text-[12px] text-muted-foreground">
                      {hours(health?.loggedHours ?? 0)} logged across the project.
                    </p>
                  )}
                </>
              )}
            </div>

            {inFlight.length > 0 && (
              <div className="rounded-xl border border-border bg-card shadow-e1">
                <div className="border-b border-border px-4 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Moving now
                  </p>
                </div>
                <ul className="divide-y divide-border/70">
                  {inFlight.map(t => (
                    <li
                      key={t.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-foreground">{t.title}</span>
                        <span className="mt-0.5 flex items-center gap-2">
                          <TaskStatusTag status={t.status} />
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <PersonChip person={t.assignee} size="xs" muted className="hidden sm:inline-flex" />
                        <DueDate date={t.dueDate} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* ── Deliverables ──────────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <Head
              title="Deliverables"
              count={deliverables.total}
              note={deliverables.total === 0
                ? 'Nothing put forward for approval'
                : `${deliverables.approved} accepted · ${deliverables.pending} waiting`}
              action={{ label: 'Files', onClick: () => onGoPanel('files') }}
            />
            <div className="rounded-xl border border-border bg-card shadow-e1">
              {deliverables.total === 0 ? (
                <Nothing
                  className="px-4"
                  title="No deliverables yet"
                  note="Share a file with the client and mark it as a deliverable to ask them to accept it. Acceptance is a fifth of this project's reported progress."
                />
              ) : (
                <ul className="divide-y divide-border/70">
                  {openDeliverables.map(f => (
                    <li key={f.id} className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {f.filename}
                        </span>
                        <span className="block truncate text-[12px] text-muted-foreground">
                          {f.approvalDecision === 'approved'
                            ? `Accepted${f.approver?.profiles?.fullName ? ` by ${f.approver.profiles.fullName}` : ''}${f.approvedAt ? ` ${relativeDay(f.approvedAt)}` : ''}`
                            : f.approvalDecision === 'rejected'
                              ? (f.approvalNote || 'The client asked for changes')
                              : `Sent ${relativeDay(f.createdAt)}, no answer yet`}
                        </span>
                      </span>
                      <span className={cn(
                        'shrink-0 whitespace-nowrap text-[12px] font-medium',
                        f.approvalDecision === 'approved' ? 'text-muted-foreground'
                          : f.approvalDecision === 'rejected' ? 'text-destructive'
                            : 'text-warning',
                      )}>
                        {f.approvalDecision === 'approved' ? 'Accepted'
                          : f.approvalDecision === 'rejected' ? 'Changes asked' : 'With the client'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* ── Right: how it is measured, and what is next ──────────────── */}
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <Head title="Progress" note="What the figure is made of" />
            <div className="rounded-xl border border-border bg-card p-4 shadow-e1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[26px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-foreground">
                  {pct(health?.progressPct ?? 0)}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {(health?.totalMilestones ?? 0) > 0
                    ? `${health?.completedMilestones} of ${health?.totalMilestones} phases`
                    : `${health?.completedTasks ?? 0} of ${health?.totalTasks ?? 0} tasks`}
                </span>
              </div>

              {/*
                The blend, drawn.

                `v_project_health` weights the plan at 50, execution at 30 and
                client acceptance at 20, renormalised over whichever signals a
                project actually has. That has been the definition since 0018
                and no screen has ever shown it, so "we are at 64%" could only
                be answered with "the database says so".
              */}
              <ProgressBreakdown
                className="mt-4 border-t border-border/70 pt-4"
                planPct={health?.planPct ?? 0}
                executionPct={health?.executionPct ?? 0}
                acceptancePct={health?.acceptancePct ?? 0}
                hasPlan={(health?.totalMilestones ?? 0) > 0}
                hasTasks={(health?.totalTasks ?? 0) > 0}
                hasDeliverables={(health?.totalDeliverables ?? 0) > 0}
              />

              {(health?.totalMilestones ?? 0) === 0 && (
                <p className="mt-3 text-[12px] text-muted-foreground">
                  This project has no roadmap, so progress is measured on tasks
                  alone. Adding phases changes what it is measured against.
                </p>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            {/*
              "Coming up" was the wrong heading for this list.

              It is the phases that are not finished, nearest first - and on a
              project that has slipped, the nearest ones are in the past. A
              section headed "Coming up" whose first two rows say "18d late"
              is a heading arguing with its own contents.
            */}
            <Head
              title="Next phases"
              count={upcoming.length}
              note={upcoming.some(m => m.dueDate && m.dueDate < today)
                ? `${upcoming.filter(m => m.dueDate && m.dueDate < today).length} already late`
                : undefined}
              action={{ label: 'Roadmap', onClick: () => onGoPanel('roadmap') }}
            />
            <div className="rounded-xl border border-border bg-card shadow-e1">
              {upcoming.length === 0 ? (
                <Nothing
                  className="px-4"
                  title="No phases ahead"
                  note={milestones.length === 0
                    ? 'The project has no roadmap yet.'
                    : 'Every phase on the roadmap is complete.'}
                />
              ) : (
                <ul className="divide-y divide-border/70">
                  {upcoming.map(m => {
                    const days = daysUntil(m.dueDate);
                    return (
                      <li key={m.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3">
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-foreground">
                            {m.name}
                          </span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-2">
                            <StageTag stage={m.stage} />
                            {m.owner?.profiles?.fullName && (
                              <span className="truncate text-[12px] text-muted-foreground">
                                {m.owner.profiles.fullName}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <DueDate date={m.dueDate} />
                          {days !== null && days > 0 && days <= 30 && (
                            <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                              {relativeDay(m.dueDate)}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* ── Money ────────────────────────────────────────────────────
              Only when the reader holds finance. The endpoint sends `null`
              rather than an empty list for exactly this: RLS would hand
              somebody without the grant zero invoices, and drawing that as
              "₦0 invoiced" is a statement, and a false one. */}
          {finance && (project.budget > 0 || finance.invoices.length > 0 || finance.expenses.length > 0) && (
            <section className="flex flex-col gap-3">
              <Head title="Money" note="Invoices and expenses filed against this project" />
              <div className="rounded-xl border border-border bg-card p-4 shadow-e1">
                <div className="grid grid-cols-3 gap-4">
                  <Figure value={exact(project.budget)} label="budget" />
                  <Figure value={exact(invoiced)} label="invoiced" />
                  <Figure value={exact(collected)} label="collected" />
                </div>
                {project.budget > 0 && (
                  <>
                    <Bar
                      className="mt-4"
                      height={5}
                      segments={[
                        { value: collected, tone: 'accent', title: 'Collected' },
                        { value: Math.max(0, invoiced - collected), tone: 'warn', title: 'Invoiced, unpaid' },
                        { value: Math.max(0, project.budget - invoiced), tone: 'quiet', title: 'Not yet invoiced' },
                      ]}
                    />
                    <p className="mt-2.5 text-[12px] text-muted-foreground">
                      {invoiced >= project.budget
                        ? 'The whole budget has been invoiced.'
                        : `${exact(project.budget - invoiced)} of the budget is not yet invoiced.`}
                      {spent > 0 && ` ${exact(spent)} in approved expenses.`}
                    </p>
                  </>
                )}
                {finance.invoices.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1.5 border-t border-border/70 pt-3">
                    {finance.invoices.slice(0, 4).map(i => (
                      <li key={i.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {i.invoiceNumber}
                          <span className="ml-2 text-muted-foreground/70">
                            {formatDay(i.issueDate, { day: 'numeric', month: 'short' })}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className={cn(
                            'capitalize',
                            i.status === 'overdue' ? 'text-destructive'
                              : i.status === 'paid' ? 'text-muted-foreground' : 'text-foreground',
                          )}>
                            {i.status.replace('_', ' ')}
                          </span>
                          <span className="tabular-nums text-foreground">{exact(Number(i.total))}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <Head
              title="Latest"
              action={{ label: 'Timeline', onClick: () => onGoPanel('timeline') }}
            />
            <div className="rounded-xl border border-border bg-card shadow-e1">
              {data.timeline.length === 0 ? (
                <Nothing className="px-4" title="Nothing has happened yet" />
              ) : (
                <ul className="divide-y divide-border/70">
                  {data.timeline
                    .filter(t => t.at <= today)
                    .slice(0, 5)
                    .map((t, i) => (
                      <li key={`${t.kind}-${t.id ?? i}`} className="flex items-start gap-3 px-4 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-foreground">{t.title}</span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            {t.detail}{t.by && ` · ${t.by}`}
                          </span>
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">
                          {formatDay(t.at, { day: 'numeric', month: 'short' })}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => onGoPanel('discussion')}
                className="group flex w-full items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-left text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {data.comments.length === 0
                  ? 'Start the discussion'
                  : `${data.comments.length} message${data.comments.length === 1 ? '' : 's'} in the discussion`}
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </section>

          {/*
            What has been written about this project in the workspace.

            A workspace page can name the project it concerns, and without this
            the link only reads in one direction - findable from the document,
            invisible from the work. It renders nothing at all when there is
            nothing linked, or when the reader does not hold the workspace
            module, so it never becomes a heading over an empty box.
          */}
          <LinkedDocuments entityType="project" entityId={data.project.id} />
        </div>
      </div>
    </div>
  );
}
