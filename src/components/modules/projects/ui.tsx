'use client';

import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initialsOf, formatDay, daysUntil } from '@/lib/format';
import {
  PROJECT_STATUS_LABELS, TASK_STATUS_LABELS, PRIORITY_LABELS, STAGE_LABELS,
  HEALTH_LABELS, type Health, type Person,
} from './types';
import { pct } from './data';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The Projects module's own vocabulary
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `components/shared/readout` says how a *figure* is drawn. This says how a
 * *project* is drawn, which is the part specific to delivery: a status, a
 * health verdict, a priority, a phase, a due date that is about to matter.
 *
 * ── On colour ────────────────────────────────────────────────────────────
 *
 * The module this replaces had four colour maps and thirty-one filled pills:
 * five project statuses, four task statuses, four priorities and three health
 * grades, each with a light and a dark variant, in `slate` / `blue` / `amber`
 * / `emerald` / `red`. A board of nine project cards drew twenty-seven of them
 * at once, so nothing on the screen could be more important than anything
 * else - which is the same failure the CRM's thirteen stage pills had, for the
 * same reason.
 *
 * Three rules replace it:
 *
 *   1. **Colour means trouble, and nothing else.** Amber and red belong to
 *      health, to a date that has passed and to a blocked task. A status, a
 *      priority and a phase are *categories*, not warnings, so they are drawn
 *      in ink and grey.
 *   2. **A sequence is drawn as a sequence.** Delivery phases run planning →
 *      development → testing → review → deployment, so they get one hue that
 *      strengthens along the way rather than five unrelated ones. Learned once,
 *      readable from across the room.
 *   3. **A dot and a word, not a filled block.** A table's job is to let the
 *      eye run down a column, and a row of coloured rectangles actively
 *      prevents it.
 *
 * `color-mix` rather than a Tailwind opacity modifier, because the phase ramp
 * is built from `--chart-1` and an arbitrary-value colour with a slash does
 * not reliably compose in Tailwind.
 */

/* -------------------------------------------------------------------------- */
/*  Health                                                                    */
/* -------------------------------------------------------------------------- */

const HEALTH_INK: Record<Health, string> = {
  on_track: 'var(--success)',
  at_risk: 'var(--warning)',
  off_track: 'var(--destructive)',
};

const HEALTH_TEXT: Record<Health, string> = {
  on_track: 'text-muted-foreground',
  at_risk: 'text-warning',
  off_track: 'text-destructive',
};

/** The verdict, as a dot and a word. */
export function HealthTag({
  health, className, strong = false,
}: {
  health: Health;
  className?: string;
  /** Ink rather than grey, for a heading where the verdict is the subject. */
  strong?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]', className)}>
      <span
        aria-hidden="true"
        className="size-[7px] shrink-0 rounded-full"
        style={{ background: HEALTH_INK[health] }}
      />
      <span className={cn(
        health === 'on_track'
          ? (strong ? 'font-medium text-foreground' : 'text-muted-foreground')
          : cn('font-medium', HEALTH_TEXT[health]),
      )}>
        {HEALTH_LABELS[health]}
      </span>
    </span>
  );
}

/**
 * ── Why a project is healthy, or is not ──────────────────────────────────
 *
 * A verdict on its own is a label somebody has to trust. "Needs attention"
 * beside a 72% bar tells a reader that something is wrong and gives them
 * nowhere to look, so the next thing they do is open six panels hunting for
 * it - which is the work the software was supposed to have done.
 *
 * These are the exact clauses of the `health` expression in
 * `v_project_health`, read back out of the counts the same view returns. They
 * are therefore not a second opinion: if a reason appears here, it is because
 * of the reason the database graded it that way, and if the grade is
 * `on_track` there are no clauses to print, so the component says what is
 * true instead - how far along, and against what.
 *
 * Nothing here is inferred, scored or summarised. Every clause names rows that
 * exist and could be counted by hand.
 */
export function healthReasons(input: {
  health: Health;
  status: string;
  endDate: string | null;
  daysRemaining: number | null;
  overdueTasks: number;
  overdueMilestones: number;
  blockedTasks: number;
  progressPct: number;
  totalMilestones: number;
  completedMilestones: number;
  totalTasks: number;
  completedTasks: number;
  pendingDeliverables?: number;
  rejectedDeliverables?: number;
  nextMilestone?: { name: string; dueDate: string | null } | null;
}): string[] {
  const out: string[] = [];
  const {
    health, status, daysRemaining, overdueTasks, overdueMilestones, blockedTasks,
    totalMilestones, completedMilestones, totalTasks, completedTasks,
    pendingDeliverables = 0, rejectedDeliverables = 0, nextMilestone,
  } = input;

  // A finished project is never at risk, however late its remaining rows look.
  if (['completed', 'cancelled', 'archived'].includes(status)) {
    return [status === 'completed' ? 'Delivered and closed' : `Project is ${status}`];
  }

  if (daysRemaining !== null && daysRemaining < 0) {
    out.push(`${Math.abs(daysRemaining)} days past the end date`);
  }
  if (overdueMilestones > 0) {
    out.push(`${overdueMilestones} phase${overdueMilestones === 1 ? '' : 's'} overdue`);
  }
  if (blockedTasks > 0) {
    out.push(`${blockedTasks} blocked task${blockedTasks === 1 ? '' : 's'}`);
  }
  if (overdueTasks > 0) {
    out.push(`${overdueTasks} overdue task${overdueTasks === 1 ? '' : 's'}`);
  }
  if (rejectedDeliverables > 0) {
    out.push(`${rejectedDeliverables} deliverable${rejectedDeliverables === 1 ? '' : 's'} sent back`);
  }

  if (health === 'on_track' && out.length === 0) {
    if (totalMilestones > 0) {
      out.push(`${completedMilestones} of ${totalMilestones} phases done`);
    } else if (totalTasks > 0) {
      out.push(`${completedTasks} of ${totalTasks} tasks done`);
    }
    if (daysRemaining !== null && daysRemaining >= 0) {
      out.push(daysRemaining === 0 ? 'Due today' : `${daysRemaining} days to the deadline`);
    }
    if (nextMilestone?.dueDate) {
      const d = daysUntil(nextMilestone.dueDate);
      out.push(
        d === null ? `Next: ${nextMilestone.name}`
          : d <= 0 ? `${nextMilestone.name} is due now`
            : `${nextMilestone.name} in ${d} day${d === 1 ? '' : 's'}`,
      );
    }
  }

  // Waiting on the customer is worth saying whatever the grade, because it is
  // the one item on the list nobody in the building can act on.
  if (pendingDeliverables > 0) {
    out.push(`${pendingDeliverables} awaiting client approval`);
  }

  return out.slice(0, 4);
}

/** The reasons, as a compact list under a verdict. */
export function HealthReasons({
  reasons, className, tone = 'default',
}: {
  reasons: string[];
  className?: string;
  tone?: 'default' | 'panel';
}) {
  if (!reasons.length) return null;
  return (
    <ul className={cn(
      'flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]',
      tone === 'panel' ? 'text-panel-muted' : 'text-muted-foreground',
      className,
    )}>
      {reasons.map((r, i) => (
        <li key={r} className="flex items-center gap-2">
          {i > 0 && (
            <span
              aria-hidden="true"
              className={cn('size-[3px] rounded-full', tone === 'panel' ? 'bg-panel-fg/30' : 'bg-border')}
            />
          )}
          {r}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status, priority, phase                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A project status.
 *
 * Ink for the states somebody is doing something about, grey for the ones that
 * are history. `on_hold` is the exception that earns a colour: it is the only
 * status that means "we stopped", and a paused engagement that reads like a
 * running one is how a month goes missing.
 */
export function StatusTag({ status, className }: { status: string; className?: string }) {
  const label = PROJECT_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
  const done = ['completed', 'archived', 'cancelled'].includes(status);
  return (
    <span className={cn(
      'whitespace-nowrap text-[12.5px]',
      status === 'on_hold' ? 'font-medium text-warning'
        : done ? 'text-muted-foreground'
          : 'font-medium text-foreground',
      className,
    )}>
      {label}
    </span>
  );
}

/**
 * A task status, as a ring that fills as work advances.
 *
 * Five states, one shape. `blocked` is the only one that takes a colour,
 * because it is the only one that is a problem rather than a position - and it
 * had no label at all in the module this replaces, so the table printed the
 * raw enum and the badge fell through to no styling.
 */
export function TaskStatusTag({ status, className }: { status: string; className?: string }) {
  const label = TASK_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
  const blocked = status === 'blocked';
  const done = status === 'done';
  const fill = done ? 100 : status === 'review' ? 66 : status === 'in_progress' ? 33 : 0;

  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]', className)}>
      {blocked ? (
        <span
          aria-hidden="true"
          className="size-[7px] shrink-0 rounded-full bg-destructive"
        />
      ) : (
        <span
          aria-hidden="true"
          className="relative size-[9px] shrink-0 rounded-full border border-border"
          style={{
            background: done
              ? 'var(--chart-1)'
              : `conic-gradient(var(--chart-1) ${fill}%, transparent 0)`,
          }}
        />
      )}
      <span className={cn(
        blocked ? 'font-medium text-destructive'
          : done ? 'text-muted-foreground'
            : 'text-foreground',
      )}>
        {label}
      </span>
    </span>
  );
}

/**
 * A priority.
 *
 * Deliberately not four coloured pills. Priority is set on almost every task,
 * so colouring it means colouring the whole table, and once everything is
 * coloured the two rows that genuinely need attention stop standing out.
 * `critical` gets weight; `high` gets ink; the rest recede. `low` is drawn as
 * a dash, because "low priority" and "nobody has thought about it" are the
 * same row and neither deserves a word.
 */
export function PriorityTag({ priority, className }: { priority: string; className?: string }) {
  const label = PRIORITY_LABELS[priority] ?? priority;
  if (priority === 'low') {
    return <span className={cn('text-[12.5px] text-muted-foreground/60', className)}>{label}</span>;
  }
  return (
    <span className={cn(
      'whitespace-nowrap text-[12.5px]',
      priority === 'critical' ? 'font-semibold text-destructive'
        : priority === 'high' ? 'font-medium text-foreground'
          : 'text-muted-foreground',
      className,
    )}>
      {label}
    </span>
  );
}

const STAGE_ORDER = ['planning', 'development', 'testing', 'review', 'deployment', 'completed'];

/** One hue, strengthening along the delivery sequence. */
export function stageInk(stage: string): string {
  const step = STAGE_ORDER.indexOf(stage);
  if (stage === 'completed') return 'var(--success)';
  const strength = step < 0 ? 45 : 28 + step * 16;
  return `color-mix(in srgb, var(--chart-1) ${strength}%, var(--muted))`;
}

export function StageTag({ stage, className }: { stage: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]', className)}>
      <span
        aria-hidden="true"
        className="size-[6px] shrink-0 rounded-full"
        style={{ background: stageInk(stage) }}
      />
      <span className="text-muted-foreground">{STAGE_LABELS[stage] ?? stage}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Progress                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The delivery bar.
 *
 * ── What it stopped doing ────────────────────────────────────────────────
 *
 * The old card coloured this bar by *value*: red under 30%, amber to 60%,
 * green above. So a project three weeks old and running perfectly to plan drew
 * a red bar, and one at 65% that was two months late drew a green one. It was
 * a rating of the number rather than of the project, and it was wrong in
 * exactly the cases somebody needed it to be right.
 *
 * Progress is now drawn in ink, and *health* carries the colour - which is the
 * signal that actually knows whether the project is in trouble.
 */
export function Progress({
  value, health, className, height = 4,
}: {
  value: number;
  /** When given, an off-track project's bar is drawn in its verdict's colour. */
  health?: Health;
  className?: string;
  height?: number;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const ink = health && health !== 'on_track' ? HEALTH_INK[health] : 'var(--chart-1)';

  return (
    <span
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('block w-full overflow-hidden rounded-full bg-border/70', className)}
      style={{ height }}
    >
      <span
        className="block h-full rounded-full transition-[width] duration-500 ease-[var(--ease-brand)]"
        style={{ width: `${v}%`, background: ink }}
      />
    </span>
  );
}

/**
 * What the progress figure is made of.
 *
 * `v_project_health` blends three signals - the plan (phases, weight 50),
 * execution (tasks, 30) and client acceptance (deliverables, 20) - renormalised
 * over whichever of them a project actually has. The blended number has been
 * on every screen since 0018 and its composition has been on none of them, so
 * "we are at 64%" was unanswerable beyond "the database says so".
 *
 * Only the components that applied are drawn: a project with no deliverables
 * has no acceptance score, and showing an empty third bar would imply it is at
 * zero rather than absent.
 */
export function ProgressBreakdown({
  planPct, executionPct, acceptancePct,
  hasPlan, hasTasks, hasDeliverables,
  className,
}: {
  planPct: number;
  executionPct: number;
  acceptancePct: number;
  hasPlan: boolean;
  hasTasks: boolean;
  hasDeliverables: boolean;
  className?: string;
}) {
  const parts = [
    hasPlan && { label: 'Plan', weight: 50, value: planPct, note: 'phases' },
    hasTasks && { label: 'Execution', weight: 30, value: executionPct, note: 'tasks' },
    hasDeliverables && { label: 'Acceptance', weight: 20, value: acceptancePct, note: 'deliverables' },
  ].filter(Boolean) as { label: string; weight: number; value: number; note: string }[];

  if (!parts.length) return null;
  const total = parts.reduce((n, p) => n + p.weight, 0);

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {parts.map(p => (
        <div key={p.label} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-3">
          <span className="text-[12px] text-muted-foreground">{p.label}</span>
          <Progress value={p.value} height={3} />
          <span className="text-right text-[12px] tabular-nums text-foreground">{pct(p.value)}</span>
        </div>
      ))}

      {/*
        The weighting, as one sentence rather than a badge per row.

        Written beside the label, it was a percentage next to a percentage -
        "Plan 63%" followed by "65%" - and no reader can tell which of the two
        is the score. The shares are renormalised over the components that
        actually applied, which is why they are printed rather than stated as
        the constants 50 / 30 / 20.
      */}
      {parts.length > 1 && (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
          Weighted{' '}
          {parts
            .map(p => `${Math.round((p.weight / total) * 100)}% ${p.label.toLowerCase()}`)
            .join(', ')}
          .
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  People and dates                                                          */
/* -------------------------------------------------------------------------- */

export function PersonChip({
  person, name, size = 'sm', className, muted = false,
}: {
  person?: Person | null;
  /** When the name is all that is available, as on the portfolio queues. */
  name?: string | null;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  muted?: boolean;
}) {
  const label = person?.profiles?.fullName ?? name ?? null;
  if (!label) {
    return <span className={cn('text-[12.5px] text-muted-foreground/60', className)}>Unassigned</span>;
  }
  const px = size === 'xs' ? 'size-4' : size === 'md' ? 'size-7' : 'size-5';
  const type = size === 'xs' ? 'text-[8px]' : size === 'md' ? 'text-[11px]' : 'text-[9px]';

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Avatar className={cn(px, 'shrink-0')}>
        {person?.profiles?.avatarUrl ? (
          <AvatarImage src={person.profiles.avatarUrl} alt="" />
        ) : null}
        <AvatarFallback className={cn(type, 'bg-muted font-medium text-muted-foreground')}>
          {initialsOf(label)}
        </AvatarFallback>
      </Avatar>
      <span className={cn(
        'truncate text-[12.5px]',
        muted ? 'text-muted-foreground' : 'text-foreground',
      )}>
        {label}
      </span>
    </span>
  );
}

/**
 * A due date that says how it is going.
 *
 * Late is the only state that takes a colour, and "due today" takes weight
 * without one. Everything further out is grey, because a date three weeks away
 * is information rather than a warning - and a table where every date is amber
 * has no way left to say that one of them is not.
 */
export function DueDate({
  date, className, prefix, done = false,
}: {
  date: string | null | undefined;
  className?: string;
  prefix?: string;
  /** A finished thing cannot be late, whatever its date says. */
  done?: boolean;
}) {
  if (!date) return <span className={cn('text-[12.5px] text-muted-foreground/50', className)}>-</span>;
  const days = daysUntil(date);
  const late = !done && days !== null && days < 0;
  const today = !done && days === 0;
  const soon = !done && days !== null && days > 0 && days <= 3;

  return (
    <span className={cn(
      'whitespace-nowrap text-[12.5px] tabular-nums',
      late ? 'font-medium text-destructive'
        : today ? 'font-medium text-warning'
          : soon ? 'text-foreground'
            : 'text-muted-foreground',
      className,
    )}>
      {late ? `${Math.abs(days!)}d late`
        : today ? 'Today'
          : `${prefix ? `${prefix} ` : ''}${formatDay(date, { day: 'numeric', month: 'short' })}`}
    </span>
  );
}

/**
 * A quiet counter with a word beside it.
 *
 * Used where a figure needs a label but not a card: the workspace header, a
 * team row, the foot of a phase column. `tone` is for the two that mean
 * trouble and nothing else.
 */
export function Figure({
  value, label, tone = 'default', className,
}: {
  value: React.ReactNode;
  label: string;
  tone?: 'default' | 'warning' | 'critical' | 'quiet';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className={cn(
        'text-[19px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
        tone === 'critical' ? 'text-destructive'
          : tone === 'warning' ? 'text-warning'
            : tone === 'quiet' ? 'text-muted-foreground'
              : 'text-foreground',
      )}>
        {value}
      </p>
      <p className="mt-1.5 truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

/**
 * An empty region that says what would be here.
 *
 * Deliberately not the shared `EmptyState`, which centres an icon in a large
 * dashed box: inside a workspace panel that is a hole in the page, and there
 * are six panels. This is one line of ink and one of grey, left-aligned with
 * everything above it, plus the action if there is one worth offering.
 */
export function Nothing({
  title, note, action, className,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-start gap-1 py-6', className)}>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {note ? <p className="max-w-prose text-[12.5px] text-muted-foreground">{note}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Panel                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A titled region, and the module's own alternative to the dashboard's bands.
 *
 * ── Why Projects needed a third shape ────────────────────────────────────
 *
 * `shared/readout` offers two: `Band`, a numeral and two uppercase words over a
 * rule, which divides a page into movements; and `Head`, a 15px ink heading
 * that labels a region drawn loose on the background. Both belong to the
 * Executive Overview's composition, where the page is one long argument read
 * top to bottom.
 *
 * Delivery is not read that way. It is a set of instruments consulted in any
 * order, so each one is a *panel* with its own frame and its own header - the
 * shape of a control room rather than of a report. The header is a small icon,
 * a 13px title, a note, and the section's own action at the far end; the body
 * decides its own padding, because a timeline and a list of rows want
 * different insets.
 */
export function Panel({
  title, note, icon: Icon, action, control, children, className, bodyClassName,
}: {
  title: string;
  note?: string;
  icon?: React.ElementType;
  action?: { label: string; onClick: () => void };
  /** A control belonging to this panel, sitting left of any action. */
  control?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-e1', className)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        {Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
        <h3 className="text-[13px] font-semibold tracking-[-0.005em] text-foreground">{title}</h3>
        {note ? (
          <p className="min-w-0 truncate text-[12px] text-muted-foreground">{note}</p>
        ) : null}
        {control || action ? (
          <span className="ml-auto flex shrink-0 items-center gap-3">
            {control}
            {action ? (
              <button
                type="button"
                onClick={action.onClick}
                className="group inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {action.label}
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ) : null}
      </header>
      <div className={cn('min-w-0 flex-1 p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
