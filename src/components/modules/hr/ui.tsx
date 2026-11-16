'use client';

import * as React from 'react';
import { AlertTriangle, ShieldCheck, Lock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { PersonAvatar } from '@/components/shared/person-avatar';
import { formatDay } from '@/lib/format';
import {
  STAGE_LABELS, STAGE_TONE, tenureLabel, labelOf, EMPLOYMENT_TYPE_LABELS,
  EVENT_LABELS, COMP_REASON_LABELS, EXIT_TYPE_LABELS,
  type EmploymentStage,
} from '@/lib/hr';
import type { RulesetVerdict } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The People module's own vocabulary.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything the shared readout primitives do not: a person on a row, an
 * employment stage as a word rather than an enum, a field on a profile, the
 * caveat that has to travel with every payroll figure.
 *
 * The rule this file exists to hold: **a person is drawn one way.** The module
 * this replaces drew a colleague four different ways - an avatar and a name in
 * the employee table, initials and a name in leave, a bare name in attendance,
 * and a hard-coded "Alex Morgan" in payroll - and the fourth was the tell that
 * nobody could see the first three side by side.
 */

/* -------------------------------------------------------------------------- */
/*  Person                                                                    */
/* -------------------------------------------------------------------------- */

export function PersonCell({
  id,
  name,
  avatarUrl,
  secondary,
  size = 'sm',
  onClick,
  className,
}: {
  id: string;
  name: string | null | undefined;
  avatarUrl?: string | null;
  /** Job title, department, or whatever this screen is actually about. */
  secondary?: React.ReactNode;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <PersonAvatar id={id} name={name ?? '—'} src={avatarUrl ?? null} size={size} decorative />
      <span className="min-w-0">
        <span className={cn(
          'block truncate font-medium text-foreground',
          size === 'lg' ? 'text-[15px]' : 'text-[13px]',
        )}>
          {name || 'Unnamed'}
        </span>
        {secondary ? (
          <span className="block truncate text-[11.5px] leading-tight text-muted-foreground">
            {secondary}
          </span>
        ) : null}
      </span>
    </>
  );

  if (!onClick) {
    return <span className={cn('flex min-w-0 items-center gap-2.5', className)}>{body}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-w-0 items-center gap-2.5 rounded-md text-left transition-colors hover:opacity-80',
        className,
      )}
    >
      {body}
    </button>
  );
}

/**
 * A stack of faces, for "four people are out this week".
 *
 * Capped at five with a count, because the sixth face is not information and a
 * row that grows with the data is a row that wraps on somebody's laptop.
 */
export function Faces({
  people,
  max = 5,
  size = 'xs',
}: {
  people: { id: string; name: string | null; avatarUrl?: string | null }[];
  max?: number;
  size?: 'xs' | 'sm';
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((p, i) => (
        <span
          key={p.id}
          className={cn('rounded-full ring-2 ring-card', i > 0 && '-ml-1.5')}
          title={p.name ?? undefined}
        >
          <PersonAvatar id={p.id} name={p.name ?? '—'} src={p.avatarUrl ?? null} size={size} decorative />
        </span>
      ))}
      {rest > 0 ? (
        <span className="-ml-1.5 flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground ring-2 ring-card">
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/**
 * An employment stage, as a word.
 *
 * The CRM shipped `closed_won` to a screen twice and it was fixed twice; this
 * is the same class of defect one module along. `notice_period` is not a
 * status, it is a database value, and the difference between those two is the
 * whole reason `lib/hr` holds a label map.
 *
 * Deliberately quiet. Only leaving carries a colour, and nothing about a
 * person is ever `destructive` - a former colleague is not an error.
 */
export function StagePill({
  stage,
  className,
}: {
  stage: EmploymentStage | string | null | undefined;
  className?: string;
}) {
  const key = (stage ?? 'active') as EmploymentStage;
  const tone = STAGE_TONE[key] ?? 'quiet';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em]',
        tone === 'accent' ? 'bg-[var(--chart-1)]/12 text-[var(--chart-1)]'
          : tone === 'warn' ? 'bg-warning/14 text-warning'
            : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {STAGE_LABELS[key] ?? key}
    </span>
  );
}

/**
 * A status word from any of the module's other vocabularies.
 *
 * One component rather than six, with the tone passed in: six near-identical
 * pill components is how a module ends up with four different greens.
 */
export function Pill({
  children,
  tone = 'quiet',
  className,
}: {
  children: React.ReactNode;
  tone?: 'quiet' | 'accent' | 'warn' | 'bad' | 'good';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em]',
        tone === 'accent' ? 'bg-[var(--chart-1)]/12 text-[var(--chart-1)]'
          : tone === 'warn' ? 'bg-warning/14 text-warning'
            : tone === 'bad' ? 'bg-destructive/12 text-destructive'
              : tone === 'good' ? 'bg-success/14 text-success'
                : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  A fact on a profile                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Label above value, left-aligned, in a column that lines up with its
 * neighbours.
 *
 * The label reserves its height for the same reason `Stat` does: "Employment
 * type" wraps in a cell where "Started" does not, and one figure sitting
 * thirteen pixels below its neighbours is the thing nobody can name and
 * everybody sees.
 */
export function Field({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="flex min-h-[1.9em] items-start text-[10.5px] font-medium uppercase leading-[1.05] tracking-[0.09em] text-muted-foreground/85">
        {label}
      </p>
      <div className="truncate text-[13px] font-medium text-foreground">{value ?? '—'}</div>
      {hint ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** The empty state this module uses everywhere, sized for a panel body. */
export function Blank({
  title,
  note,
  action,
  className,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-4 py-8 text-center', className)}>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {note ? (
        <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
          {note}
        </p>
      ) : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * The loading state, shaped like the thing that is coming.
 *
 * Rows of the right height in the right places, so the page does not jump when
 * the data lands. A spinner in the middle of an empty panel tells the reader
 * nothing about what they are waiting for.
 */
export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2 px-4 py-3', className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="size-7 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="h-3 flex-1 animate-pulse rounded bg-muted" style={{ maxWidth: `${70 - i * 8}%` }} />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The payroll caveat                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What `describeRuleset()` decided, rendered.
 *
 * **This travels with every payroll figure in the product**, and it is the
 * mechanism behind the brief's rule that a calculation must not claim
 * compliance it does not have. Three states and the middle one is the point: a
 * ruleset with steps that nobody has certified computes something believable,
 * which is exactly when a person believes it.
 *
 * Drawn as a line of text rather than a dismissible banner, because a caveat
 * somebody can close is a caveat that is closed.
 */
export function Verdict({
  verdict,
  className,
}: {
  verdict: RulesetVerdict | null | undefined;
  className?: string;
}) {
  if (!verdict) return null;
  const Icon = verdict.trustworthy ? ShieldCheck : AlertTriangle;
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5',
        verdict.trustworthy
          ? 'border-border bg-muted/40'
          : 'border-warning/30 bg-warning/[0.07]',
        className,
      )}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', verdict.trustworthy ? 'text-success' : 'text-warning')}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className={cn(
          'text-[12.5px] font-semibold',
          verdict.trustworthy ? 'text-foreground' : 'text-warning',
        )}>
          {verdict.headline}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {verdict.detail}
        </p>
      </div>
    </div>
  );
}

/**
 * The note a panel carries when its contents are restricted.
 *
 * Used where the *absence* is meaningful and would otherwise read as "there is
 * nothing here" - an offer a hiring manager cannot see, a salary a manager
 * cannot see. Saying which of the two kinds of empty this is costs one line
 * and saves the reader from concluding the record does not exist.
 */
export function Restricted({ what, className }: { what: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 px-4 py-6 text-center', className)}>
      <Lock className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <p className="text-[12px] text-muted-foreground">{what}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small formatters used on more than one screen                             */
/* -------------------------------------------------------------------------- */

/*
  `personLine()` lived here — "Engineering · Full time · 2y 3m", the line under
  a person's name — and nothing in the repository ever called it. Every screen
  that wants that line composes it inline, because each wants a slightly
  different subset of the four parts.

  Removed rather than kept for a future caller: a helper nobody uses is a
  helper nobody has checked, and this one silently omitted `full_time` on the
  assumption that the reader would infer it. Whichever screen needs it next
  should decide that for itself.
*/

/** A date, or an em dash. `formatDay` because a bare `date` is not an instant. */
export function day(value: string | null | undefined): string {
  return value ? formatDay(value) : '—';
}

/**
 * What an employment event actually says, in a sentence.
 *
 * ── The defect this exists to close ──────────────────────────────────────
 *
 * `employment_events.reason` is free text for most kinds and a **stored enum
 * value** for two of them: `compensation_change` writes the
 * `comp_change_reason` and `offboarded` writes the `exit_type`, both by
 * trigger and both deliberately - the history should say *why*, and the reason
 * is already an enum in the table that caused it.
 *
 * Printing that column raw put "market_adjustment" and "resignation" on HR
 * Home, which is the same raw-enum-on-a-screen defect the CRM shipped twice
 * and fixed twice. One describer, used by the timeline on the profile and the
 * activity feed on Home, so the next screen to render an event cannot get a
 * third answer.
 */
export function eventLine(e: {
  kind: string;
  reason?: string | null;
  note?: string | null;
  titleBefore?: string | null;
  titleAfter?: string | null;
  departmentFrom?: { name: string } | null;
  departmentTo?: { name: string } | null;
  employmentTypeBefore?: string | null;
  employmentTypeAfter?: string | null;
  managerBefore?: string | null;
  managerAfter?: string | null;
}): string {
  const parts: string[] = [];

  if (e.titleAfter && e.titleAfter !== e.titleBefore) {
    parts.push(e.titleBefore ? `${e.titleBefore} → ${e.titleAfter}` : e.titleAfter);
  }
  if (e.departmentTo?.name && e.departmentTo.name !== e.departmentFrom?.name) {
    parts.push(e.departmentFrom?.name
      ? `${e.departmentFrom.name} → ${e.departmentTo.name}`
      : `Joined ${e.departmentTo.name}`);
  }
  if (e.employmentTypeAfter && e.employmentTypeAfter !== e.employmentTypeBefore) {
    parts.push(labelOf(EMPLOYMENT_TYPE_LABELS, e.employmentTypeAfter));
  }
  if (e.managerAfter && e.managerAfter !== e.managerBefore) {
    parts.push('Reporting line changed');
  }

  /* The two kinds whose `reason` is an enum rather than a sentence. */
  const reason =
    e.kind === 'compensation_change' ? labelOf(COMP_REASON_LABELS, e.reason)
      : e.kind === 'offboarded' ? labelOf(EXIT_TYPE_LABELS, e.reason)
        : (e.reason ?? '');

  const summary = parts.join(' · ');
  const trailing = reason && reason !== summary ? reason : '';

  return [summary, trailing, e.note].filter(Boolean).join(' — ')
    || labelOf(EVENT_LABELS, e.kind);
}
