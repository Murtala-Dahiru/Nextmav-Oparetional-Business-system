'use client';

import * as React from 'react';
import {
  PhoneCall, Mail, CalendarClock, Video, MapPin, MonitorPlay, FileText,
  CornerUpRight, StickyNote, Circle, Search, X, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initialsOf } from '@/lib/format';
import { STAGE_LABELS, LEAD_STATUS_LABELS, type Member } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The CRM's own vocabulary
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The readout primitives in `components/shared/readout` say how a *figure* is
 * drawn. These say how a *record* is drawn, which is the part that is specific
 * to selling: a stage, a lead status, a score, an owner, an activity type.
 *
 * ── On colour ────────────────────────────────────────────────────────────
 *
 * The module this replaces gave each of the six deal stages a hue of its own -
 * cyan, blue, violet, orange, emerald, red - and did the same for the seven
 * lead statuses. Thirteen saturated pills in one product, none of which meant
 * anything except "this is a different value from that one", and a pipeline
 * board that read as a paint chart.
 *
 * A pipeline is a *sequence*, so it is drawn as one: a single hue that
 * strengthens as a deal advances. The reader learns it once and can then read
 * progress from across the room. Only the two outcomes get a colour of their
 * own, because won and lost are the two things that are genuinely different in
 * kind rather than further along.
 *
 * `color-mix` rather than a Tailwind opacity modifier, because the ramp is
 * built from `--chart-1` and an arbitrary-value colour with a slash does not
 * reliably compose in Tailwind.
 */

const STAGE_ORDER = ['prospecting', 'qualification', 'proposal', 'negotiation'];

function stageInk(stage: string): string {
  if (stage === 'closed_won') return 'var(--success)';
  if (stage === 'closed_lost') return 'var(--destructive)';
  const step = STAGE_ORDER.indexOf(stage);
  const strength = step < 0 ? 55 : 30 + step * 22;
  return `color-mix(in srgb, var(--chart-1) ${strength}%, var(--muted))`;
}

/** The same ramp, for a recharts series that cannot take a CSS function. */
export function stageColour(stage: string, palette: { cash: string; bad: string; flat: string }): string {
  if (stage === 'closed_won') return palette.cash;
  if (stage === 'closed_lost') return palette.bad;
  return palette.cash;
}

/* -------------------------------------------------------------------------- */
/*  Stage and status                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A stage, as a dot and a word.
 *
 * Not a filled pill. Thirteen filled pills per screen is what made the old
 * tables loud, and a table's job is to let the eye run down a column - which
 * a row of coloured blocks actively prevents. The dot carries the colour, the
 * word carries the meaning, and the row stays quiet.
 */
export function StageTag({ stage, className }: { stage: string; className?: string }) {
  const label = STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ');
  const closed = stage === 'closed_won' || stage === 'closed_lost';

  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]', className)}>
      <span
        aria-hidden="true"
        className="size-[7px] shrink-0 rounded-full"
        style={{ background: stageInk(stage) }}
      />
      <span className={cn(closed ? 'font-medium text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </span>
  );
}

/**
 * A lead status, on the same principle.
 *
 * The lifecycle runs New → Contacted → Qualified → Proposal → Negotiation and
 * ends Won or Lost, which is a sequence with the same shape as the deal
 * pipeline - so it gets the same ramp rather than a second colour language for
 * the same idea.
 */
const LEAD_ORDER = ['new', 'contacted', 'qualified', 'proposal', 'negotiation'];

export function LeadStatusTag({ status, className }: { status: string; className?: string }) {
  const label = LEAD_STATUS_LABELS[status] ?? status;
  const won = status === 'won';
  const lost = status === 'lost';
  const step = LEAD_ORDER.indexOf(status);
  const ink = won ? 'var(--success)'
    : lost ? 'var(--destructive)'
      : `color-mix(in srgb, var(--chart-1) ${step < 0 ? 55 : 25 + step * 18}%, var(--muted))`;

  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]', className)}>
      <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full" style={{ background: ink }} />
      <span className={cn(won || lost ? 'font-medium text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Probability and score                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A 0-100 judgement, drawn as a bar and read as a number.
 *
 * The old version used three colours by threshold - red under 30, amber under
 * 60, green above - which is a value judgement the data does not support: a
 * lead scored 25 is not a *problem*, it is early. One neutral bar whose length
 * is the value says the same thing without the editorial.
 */
export function Gauge({
  value, label, className,
}: {
  value: number; label?: string; className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className="block h-[5px] w-14 shrink-0 overflow-hidden rounded-full bg-border/70"
        role="img"
        aria-label={`${label ? `${label}: ` : ''}${pct} out of 100`}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: 'color-mix(in srgb, var(--chart-1) 80%, transparent)' }}
        />
      </span>
      <span className="w-7 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{pct}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  People                                                                    */
/* -------------------------------------------------------------------------- */

export function personName(p?: { firstName?: string; lastName?: string } | null): string {
  if (!p) return '';
  return `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
}

/**
 * How a record reads on somebody's personal My Work list.
 *
 * "Corvo Health · Corvo Health - hardware refresh" is the shape a blind join
 * produces, because a deal is very often named after its customer. The company
 * is dropped when the record's own name already opens with it.
 */
export function sourceLabel(company: string | null | undefined, name: string): string {
  const co = (company ?? '').trim();
  if (!co) return name;
  if (!name) return co;
  return name.toLowerCase().startsWith(co.toLowerCase()) ? name : `${co} · ${name}`;
}

export function memberName(m?: Member | null): string {
  return m?.profiles?.fullName ?? '';
}

/**
 * Whoever owns this record.
 *
 * Renders the word "Unassigned" rather than an empty cell, because an
 * unassigned lead is a fact worth seeing - it is the most common reason a lead
 * is never worked, and a blank cell reads as a rendering fault.
 */
export function OwnerTag({
  member, className, showName = true,
}: {
  member?: Member | null; className?: string; showName?: boolean;
}) {
  const name = memberName(member);

  if (!name) {
    return (
      <span className={cn('text-[12.5px] text-muted-foreground/70', className)}>Unassigned</span>
    );
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Avatar className="size-5 shrink-0">
        {member?.profiles?.avatarUrl
          ? <AvatarImage src={member.profiles.avatarUrl} alt="" />
          : null}
        <AvatarFallback className="bg-muted text-[9px] font-medium text-muted-foreground">
          {initialsOf(name)}
        </AvatarFallback>
      </Avatar>
      {showName && <span className="truncate text-[12.5px] text-muted-foreground">{name}</span>}
    </span>
  );
}

/** A round monogram for a lead or contact, used where there is no avatar. */
export function Monogram({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10.5px] font-semibold text-muted-foreground',
        className,
      )}
    >
      {initialsOf(name) || '?'}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Activities                                                                */
/* -------------------------------------------------------------------------- */

export const ACTIVITY_ICON: Record<string, React.ElementType> = {
  call: PhoneCall,
  email: Mail,
  meeting: CalendarClock,
  video: Video,
  visit: MapPin,
  demo: MonitorPlay,
  proposal: FileText,
  followup: CornerUpRight,
  note: StickyNote,
  other: Circle,
};

export function activityIcon(type: string): React.ElementType {
  return ACTIVITY_ICON[type] ?? Circle;
}

/* -------------------------------------------------------------------------- */
/*  Search                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The search field every CRM list carries.
 *
 * Debounced here rather than in each list, and - the part that matters - the
 * input is *uncontrolled by the parent's fetch state*. A field whose value is
 * reset when a request lands eats the character somebody typed while it was in
 * flight, which is the most common way a search box feels broken.
 */
export function SearchField({
  placeholder, onChange, defaultValue = '', className, pending,
}: {
  placeholder: string;
  onChange: (value: string) => void;
  defaultValue?: string;
  className?: string;
  pending?: boolean;
}) {
  const [value, setValue] = React.useState(defaultValue);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef(onChange);
  React.useEffect(() => { latest.current = onChange; });

  const set = React.useCallback((next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(next.trim()), 280);
  }, []);

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    /*
      `w-full` matters more than it looks.

      A bare `<div>` inside a flex row takes its base size from its content,
      and an `<input>`'s content is its `size` attribute - about twenty
      characters. Every search field in the module rendered at roughly 215px
      whatever `max-w-*` said, and clipped its own placeholder.
    */
    <div className={cn('relative w-full', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={value}
        onChange={e => set(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 rounded-md pl-8 pr-8 text-[13px]"
      />
      {pending && !value ? null : value ? (
        <button
          type="button"
          onClick={() => { setValue(''); latest.current(''); }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Filters                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A filter as a row of words, not a dropdown.
 *
 * ── Why not a `Select` ───────────────────────────────────────────────────
 *
 * A dropdown hides both the options and the current state behind a click, and
 * the CRM's filters are short closed lists - six stages, seven statuses - that
 * fit on one line. Shown inline, the reader can see what the filter *could*
 * be, see what it *is*, and change it in one click instead of three.
 *
 * Below `sm` the row scrolls horizontally rather than wrapping into three
 * lines, and the scroll is the affordance: the row is deliberately cut off at
 * the edge rather than fading, so it is obvious there is more.
 */
export function FilterRow({
  options, value, onChange, ariaLabel, className,
}: {
  options: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'flex items-center gap-0.5 overflow-x-auto rounded-md bg-muted p-0.5',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value || 'all'}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 py-[5px] text-[12.5px] font-medium transition-colors',
              on
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn(
                'text-[11px] tabular-nums',
                on ? 'text-muted-foreground' : 'text-muted-foreground/70',
              )}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The open book, split by stage, on the pipeline's own colour ramp.
 *
 * ── Why not the shared `Bar` ─────────────────────────────────────────────
 *
 * `Bar` takes a closed set of tones - accent, warn, bad, quiet, claim - which
 * exist to say what a segment *means*. A pipeline's segments do not mean five
 * different things; they are one thing at four points along a sequence, and
 * drawing three of them "quiet" and the last one "accent" reduced the bar to a
 * single fact: how much is nearly done. That is worth knowing and it is not
 * what a composition bar is for.
 *
 * On the ramp the shape is readable at a glance: a bar that darkens towards
 * the right is a book about to close, and one that is pale all the way across
 * is a quarter's work still to do.
 */
export function StageSplit({
  segments, className,
}: {
  segments: { stage: string; value: number }[];
  className?: string;
}) {
  const live = segments.filter(s => s.value > 0);
  const total = live.reduce((sum, s) => sum + s.value, 0);
  if (!total) return null;

  return (
    <span
      role="img"
      aria-label={live.map(s => `${STAGE_LABELS[s.stage] ?? s.stage}: ${s.value}`).join(', ')}
      className={cn('flex h-1 w-full overflow-hidden rounded-full bg-panel-fg/10', className)}
    >
      {live.map(s => (
        <span
          key={s.stage}
          title={STAGE_LABELS[s.stage] ?? s.stage}
          className="h-full transition-[width] duration-700 ease-[var(--ease-brand)]"
          style={{
            width: `${(s.value / total) * 100}%`,
            background: `color-mix(in srgb, var(--panel-accent) ${
              28 + STAGE_ORDER.indexOf(s.stage) * 24
            }%, transparent)`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * A single on/off filter, in the same shape as one `FilterRow` pill.
 *
 * A `Switch` in a bordered box was two visual languages on one toolbar: a
 * segmented control saying "which of these", and a settings toggle saying
 * "on or off". Both are filters and both should look like filters, so this is
 * the pill with `aria-pressed` instead of `aria-checked`.
 */
export function FilterToggle({
  label, active, onChange, className,
}: {
  label: string;
  active: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onChange(!active)}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-[6px] text-[12.5px] font-medium transition-colors',
        active
          ? 'border-foreground/25 bg-accent text-foreground'
          : 'border-border bg-card text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-[7px] rounded-full transition-colors',
          active ? 'bg-[var(--chart-1)]' : 'bg-border',
        )}
      />
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  States                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * An empty state that says what to do, not that there is nothing.
 *
 * "No leads found" is a statement of the obvious and gives the reader nowhere
 * to go. Every one of these takes an action, and the copy names the next step.
 */
export function Blank({
  icon: Icon, title, body, action, className,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-[18px]" />
      </span>
      <p className="text-[14px] font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A section that is still loading, at the shape of the thing it precedes. */
export function Shimmer({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

/**
 * A read that failed, said out loud with the way back.
 *
 * The module used to raise a toast and render an empty table, so a screen that
 * could not reach the server looked exactly like a workspace with no data in
 * it - and "we have no leads" is a very different conclusion from "the leads
 * did not load".
 */
export function Broken({
  message, onRetry, className,
}: {
  message: string; onRetry: () => void; className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-destructive/25 bg-destructive/[0.04] px-4 py-6 text-center', className)}>
      <p className="text-[13px] font-medium text-foreground">This did not load</p>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-accent"
      >
        Try again
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Layout                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The heading every CRM section carries.
 *
 * One `h2` - the shell's header holds the only `h1` - the count beside it
 * rather than under it, and the primary action at the far end in ink. The old
 * module used `PageHeader`, whose description line ran to a sentence of
 * marketing ("Track and manage your sales leads") that told a salesperson
 * nothing they did not know from the word Leads.
 */
export function SectionHead({
  title, count, note, children, className,
}: {
  title: string;
  count?: number | string;
  note?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-foreground">{title}</h2>
      {count !== undefined && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      {note && <span className="hidden text-[12.5px] text-muted-foreground sm:inline">{note}</span>}
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** A labelled figure, for the strips under a section heading. */
export function Figure({
  label, value, note, tone = 'default', onClick,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[10.5px] font-medium uppercase leading-none tracking-[0.09em] text-muted-foreground/85">
        {label}
      </p>
      <p className={cn(
        'mt-2 text-[19px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
        tone === 'good' ? 'text-success'
          : tone === 'warn' ? 'text-warning'
            : tone === 'bad' ? 'text-destructive'
              : 'text-foreground',
      )}>
        {value}
      </p>
      {note && <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground">{note}</p>}
    </>
  );

  if (!onClick) return <div className="px-4 py-3.5">{body}</div>;
  return (
    <button type="button" onClick={onClick} className="px-4 py-3.5 text-left transition-colors hover:bg-accent/50">
      {body}
    </button>
  );
}

/**
 * A divided strip of figures.
 *
 * Dividers rather than gaps, and a wrapping grid rather than a fixed one, so
 * five figures cannot orphan a sixth cell at any width - the failure the
 * Executive Overview pass hit and solved the same way.
 */
export function Strip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-e1',
      'sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0',
      '[&>*]:min-w-0',
      className,
    )}>
      {children}
    </div>
  );
}
