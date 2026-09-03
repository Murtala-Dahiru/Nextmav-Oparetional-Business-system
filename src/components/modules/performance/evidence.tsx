'use client';

import * as React from 'react';
import {
  CheckSquare, Target as TargetIcon, CalendarCheck, Handshake,
  Award, ClipboardCheck, Info, ChevronDown,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { useAppStore } from '@/store/app-store';
import { useModuleRealtime } from '@/hooks/use-realtime';

import { useEndpoint, money, formatDay } from './data';
import { SectionHead, Figure, FigureRow, Spinner, Broken } from './ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The evidence behind one person's performance
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this screen is answering ────────────────────────────────────────
 *
 * "How am I doing here, and what is the evidence for it." Until now the
 * Performance module answered a narrower question — how are your deals going —
 * which is the right question for a salesperson and a permanently empty screen
 * for everybody else in the company.
 *
 * ── Why every figure carries its workings ────────────────────────────────
 *
 * A performance number that cannot be checked is a number that gets argued
 * about instead of acted on. Each figure here prints what it was computed
 * from underneath it — how many observations, over what, from which source —
 * because the person being described is the one most entitled to audit it, and
 * because a manager about to raise something in a review needs to know whether
 * "91% on time" rests on eleven tasks or two.
 *
 * ── Why some figures are deliberately blank ──────────────────────────────
 *
 * `value: null` with a sample below the threshold renders as "Not enough yet"
 * rather than as a percentage. A win rate computed from one deal is not a win
 * rate, and showing it as 100% invites a conversation about noise. The count it
 * does have is shown instead, which is the honest version of the same fact.
 *
 * ── Why there is no overall score ────────────────────────────────────────
 *
 * The same reason `me.tsx` gives, and it is worth repeating where somebody
 * might come looking to add one: a composite number needs invented weights,
 * and the moment it exists it gets used to make decisions that the weights
 * cannot support. Sections stay separate so a person is read rather than
 * ranked.
 */

type Provenance = 'event' | 'record';

interface Metric {
  key: string;
  label: string;
  value: number | null;
  unit: 'count' | 'percent' | 'money' | 'days';
  sample: number;
  basis: string;
  provenance: Provenance;
}

interface Section {
  area: string;
  label: string;
  module: string;
  note: string;
  metrics: Metric[];
  available: boolean;
  unavailable?: string;
}

interface TimelineEntry {
  at: string;
  kind: string;
  title: string;
  detail: string;
  area: string;
  provenance: Provenance;
  openIn: { module: string; type: string; id: string } | null;
}

export interface EvidenceData {
  member: { id: string; name: string; jobTitle: string | null };
  self: boolean;
  period: { start: string; end: string; label: string; today: string };
  currency: string;
  sections: Section[];
  timeline: TimelineEntry[];
  sources: { area: string; label: string; module: string; note: string; events: string[]; tables: string[] }[];
}

/** One icon per area, so a section is recognisable before it is read. */
const AREA_ICON: Record<string, React.ElementType> = {
  delivery: CheckSquare,
  goals: TargetIcon,
  attendance: CalendarCheck,
  commercial: Handshake,
  recognition: Award,
  review: ClipboardCheck,
};

function metricText(m: Metric, currency: string): string {
  if (m.value === null) return 'Not enough yet';
  switch (m.unit) {
    case 'money': return money(m.value, currency);
    case 'percent': return `${m.value}%`;
    case 'days': return `${formatNumber(m.value)}d`;
    default: return formatNumber(m.value);
  }
}

/**
 * The line under each figure.
 *
 * When a rate was suppressed, the sample is the interesting fact — "4
 * observations" tells the reader why there is no percentage. When it was not,
 * the basis text explains what was divided by what.
 */
function metricSub(m: Metric): string {
  if (m.value === null) {
    return m.sample > 0
      ? `${formatNumber(m.sample)} so far — too few to give a rate`
      : 'Nothing recorded yet';
  }
  return m.basis;
}

function EvidenceSection({ section, currency }: { section: Section; currency: string }) {
  const Icon = AREA_ICON[section.area] ?? CheckSquare;

  return (
    <section className="flex flex-col gap-3">
      <SectionHead title={section.label} note={section.note}>
        <Icon className="size-4 text-muted-foreground" />
      </SectionHead>

      {section.available ? (
        <FigureRow className="sm:grid-cols-3">
          {section.metrics.map(m => (
            <Figure
              key={m.key}
              label={m.label}
              value={metricText(m, currency)}
              sub={metricSub(m)}
              tone={m.value === null ? 'default' : undefined}
            />
          ))}
        </FigureRow>
      ) : (
        /**
         * An unavailable section is one line, not an empty card the height of a
         * populated one. Six full-size empty states stacked down a page reads
         * as a broken product; six quiet lines reads as a record that is
         * honest about its own gaps.
         */
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
          {section.unavailable}
        </p>
      )}
    </section>
  );
}

/**
 * Where the figures came from, on request.
 *
 * Collapsed by default because it is reference rather than reading, and
 * present at all because "what feeds this" should be answerable from inside
 * the product rather than from the source. The list is served by the API from
 * the same registry the figures are computed from, so it cannot drift into
 * describing a source that no longer contributes.
 */
function Provenance({ sources }: { sources: EvidenceData['sources'] }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <Info className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">Where these figures come from</span>
        <ChevronDown
          className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
            Nothing here counts logins, messages, or time spent in the application. Every figure is
            either something that was finished or a rate over things that were finished. Figures marked
            <span className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px] font-medium">frozen</span>
            were recorded at the moment they happened and do not change if a due date is edited later;
            figures marked
            <span className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px] font-medium">live</span>
            are read from the record as it stands today, including any corrections made to it.
          </p>
          <ul className="flex flex-col gap-2">
            {sources.map(s => (
              <li key={s.area} className="text-[12.5px] leading-relaxed">
                <span className="font-medium text-foreground">{s.label}</span>
                <span className="text-muted-foreground"> — {s.note}.</span>
                <span className="ml-1 text-muted-foreground/80">
                  {s.events.length > 0 && <>Frozen: {s.events.join(', ')}. </>}
                  {s.tables.length > 0 && <>Live: {s.tables.join(', ')}.</>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  /**
   * A bare selector, not one that builds an object.
   *
   * Zustand v5 re-runs the selector on every store change and compares the
   * result by identity, so a selector returning a fresh object loops for ever
   * and presents as "the module will not render".
   */
  const openRecord = useAppStore(s => s.openRecord);

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-3 text-[12.5px] text-muted-foreground">
        Nothing has been recorded for this period yet.
      </p>
    );
  }

  return (
    <ol className="overflow-hidden rounded-xl border border-border bg-card">
      {entries.map((e, i) => {
        const Icon = AREA_ICON[e.area] ?? CheckSquare;

        const body = (
          <>
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-[14px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">{e.title}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{e.detail}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">
              {formatDay(e.at)}
            </span>
          </>
        );

        return (
          <li key={`${e.kind}-${e.at}-${i}`} className={cn(i > 0 && 'border-t border-border')}>
            {e.openIn ? (
              <button
                type="button"
                onClick={() => openRecord(e.openIn!.module as never, e.openIn!.type, e.openIn!.id)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
              >
                {body}
              </button>
            ) : (
              <div className="flex items-start gap-3 px-4 py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The evidence record for one person.
 *
 * Takes its period from the caller rather than owning one, so it sits inside
 * `me.tsx` under the same period control as the commercial figures instead of
 * introducing a second one that can disagree with it.
 */
export function EvidenceRecord({
  memberId, from, to, hideAreas,
}: {
  memberId?: string | null;
  from?: string | null;
  to?: string | null;
  /**
   * Areas the caller is already showing in more depth, and which must
   * therefore not appear here as well.
   *
   * This exists for exactly one situation, and it is worth naming: on
   * `me.tsx`, a person with a commercial record gets the full CRM detail
   * — targets against pace, closures, pipeline by stage — immediately below
   * this. Rendering the commercial summary here too put the *same question*
   * on the page twice with two different answers: this layer suppresses a win
   * rate computed from a single deal, and the detail below happily prints
   * "100%". Both are defensible rules and having both on one screen is not.
   *
   * The API still returns the section either way. A manager reading somebody's
   * record from a review screen has no CRM detail beneath it and needs the
   * commercial figures in the record, so this is a decision for the screen
   * rather than for the route.
   */
  hideAreas?: readonly string[];
}) {
  const url = React.useMemo(() => {
    const q = new URLSearchParams();
    if (memberId) q.set('member', memberId);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return `/api/performance/evidence?${q}`;
  }, [memberId, from, to]);

  const { data, loading, error, reload } = useEndpoint<EvidenceData>(url);

  /**
   * Evidence arrives while the screen is open.
   *
   * Finishing a task, checking in, having a goal marked achieved or a review
   * shared are all things that happen *to* this screen from elsewhere in the
   * product — often from another tab the same person has open. Without this,
   * somebody completes a task in Projects, switches to Performance, and finds
   * a record that does not mention it until they reload.
   *
   * The tables are the ones the six sections actually read. `tasks` is
   * deliberately absent even though delivery is computed from it: the figures
   * come from `business_events`, which is written in the same transaction as
   * the task update, so subscribing to both would refetch twice for one event.
   * The exception is the overdue count, which is read live from `tasks` — and
   * a due date passing is not something realtime can deliver anyway, because
   * no row changes when a day ends.
   */
  useModuleRealtime(
    'performance-evidence',
    ['business_events', 'attendance_records', 'attendance_adjustments',
      'performance_goals', 'performance_achievements', 'performance_reviews'],
    reload,
  );

  if (loading && !data) return <Spinner label="Gathering your evidence" />;
  if (error) return <Broken message={error} onRetry={reload} />;
  if (!data) return null;

  /**
   * Sections with something in them first.
   *
   * A stable order would put an empty section above a full one for anybody
   * whose work does not happen to match the declaration order in the registry.
   * Sorting by availability keeps a person's own record legible without
   * hiding what is missing — the empty ones are still there, underneath.
   */
  const ordered = data.sections
    .filter(s => !hideAreas?.includes(s.area))
    .sort((a, b) => Number(b.available) - Number(a.available));

  return (
    <div className="flex flex-col gap-7">
      {ordered.map(s => (
        <EvidenceSection key={s.area} section={s} currency={data.currency} />
      ))}

      <section className="flex flex-col gap-3">
        <SectionHead
          title="Timeline"
          note="Things that happened, in the order they happened. Not a summary."
          count={data.timeline.length}
        />
        <Timeline entries={data.timeline} />
      </section>

      <Provenance sources={data.sources} />
    </div>
  );
}
