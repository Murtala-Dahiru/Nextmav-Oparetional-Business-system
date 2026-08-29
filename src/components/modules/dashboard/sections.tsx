'use client';

import * as React from 'react';
import { ArrowRight, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  formatDate, formatRelativeTime, activeLocaleCode,
  getInitials,
} from '@/lib/format';
import { MODULES, statusLabel } from '@/lib/constants';
import {
  Head, TRow, THead, Rail, Meter, Chip, Stat, severityWord,
} from '@/components/shared/readout/primitives';
import { money } from '@/components/shared/readout/viz';
import type {
  AttentionItem, DashboardActivity, DashboardEvent,
  DashboardInventory, DashboardSupport, DashboardTask, Severity,
} from './types';

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** Time only. `formatDate` with hour options appends the date as well. */
function timeOf(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(activeLocaleCode(), { hour: '2-digit', minute: '2-digit' });
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

/** "CRM", not "Crm": a CSS `capitalize` over a module id gets two of thirteen wrong. */
function moduleLabel(id: string): string {
  return MODULES.find(m => m.id === id)?.label ?? id;
}

/**
 * How long a support ticket has, or how long it has been over.
 *
 * `dueDate` on a ticket is the SLA deadline, not a calendar date, so the unit
 * that matters changes with the distance: a ticket due in three hours and one
 * due in three days are different situations and "3" is not the answer to
 * either. Days once it is past a day, hours below that, and "now" inside the
 * final minutes — rounding "in 40 minutes" up to "in 1h" is the wrong
 * direction to round a deadline.
 */
function slaIn(due: string | null): { text: string; over: boolean; soon: boolean } | null {
  if (!due) return null;
  const ms = new Date(due).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;

  const over = ms < 0;
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / 3_600_000);
  const days = Math.floor(hours / 24);

  const span = days >= 1 ? `${days}d` : hours >= 1 ? `${hours}h` : `${Math.floor(abs / 60_000)}m`;
  return { text: over ? `${span} over` : `in ${span}`, over, soon: !over && hours < 24 };
}

/* -------------------------------------------------------------------------- */
/*  Needs attention — the operational queue                                   */
/* -------------------------------------------------------------------------- */
/**
 * ── What changed, and why ─────────────────────────────────────────────────
 *
 * The queue already made the right decision — one row per concern, ordered by
 * severity, gated on what the role may actually do. What it did not do was
 * *look* like a control surface. Two problems, both visible at 1400px:
 *
 *  1. **It never said how bad the list was.** Eight rows with coloured edges,
 *     and no sentence anywhere saying three of them were critical. The reader
 *     had to count edges. A count of the whole is the first thing an operator
 *     wants and the cheapest thing to give them.
 *  2. **Half the row was empty.** `[title 1fr][module 7.5rem][action]` over
 *     eight hundred pixels, with titles that run to about forty characters —
 *     so every row was a short sentence, four hundred pixels of nothing, then
 *     a module name. Reading it felt like reading a spreadsheet with a deleted
 *     column, which is exactly what it was.
 *
 * The summary chips answer the first and also filter, so the count is not
 * merely decorative. `state` answers the second — see the note on
 * `AttentionItem` for why a restatement of the rule is honest where a second
 * measurement would not be.
 */
/**
 * ── The column that was removed ───────────────────────────────────────────
 *
 * There used to be a module column between the state and the action: the row
 * read `… [Past deadline] [Support] [Open support →]`. Two cells, side by
 * side, carrying the same word. Nine rows of that is a column of redundancy
 * down the middle of the page's most important list, and it was taking seven
 * rems from the only cell whose content varies — the title, which is the
 * thing anybody actually reads.
 *
 * The action label already names the destination, which is where the reader
 * looks when the question is "where do I deal with this".
 */
/**
 * ── Why the action column is a fixed width and not `auto` ─────────────────
 *
 * Every row here is its own grid — `TRow` is one element per row, not a table
 * — so an `auto` track is sized by *that row's* content and nothing else. The
 * effect is that a row ending in "Open HR" gave its `1fr` title cell more
 * room than one ending in "Open Finance", which pushed its state chip
 * twenty-odd pixels right of the chip above it. Nine rows, three or four
 * different left edges, none of them wrong on their own.
 *
 * A fixed track is the only thing that makes independent grids agree. 8.5rem
 * holds the longest label the queue can produce ("Open My Work →") with room
 * to spare, and the cell right-aligns so the arrows form a straight edge down
 * the page.
 */
const ATTENTION_COLS =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_9.5rem_8.5rem]';

/**
 * The filter labels are shorter than the severity words they filter on.
 *
 * `severityWord` says "Needs attention" for a warning, which is right in a
 * screen-reader announcement — "Needs attention. Three projects need
 * attention." — and absurd as a chip inside a section already titled *Needs
 * attention*. The chips are three parallel one-word states; the accessible
 * name keeps the fuller phrase.
 */
const FILTERS: { severity: Severity; label: string }[] = [
  { severity: 'critical', label: 'Critical' },
  { severity: 'warning', label: 'Warning' },
  { severity: 'info', label: 'Informational' },
];

export function AttentionSection({
  items,
  onAct,
}: {
  items: AttentionItem[];
  onAct: (item: AttentionItem) => void;
}) {
  const [only, setOnly] = React.useState<Severity | null>(null);

  const counts = React.useMemo(() => ({
    critical: items.filter(i => i.severity === 'critical').length,
    warning: items.filter(i => i.severity === 'warning').length,
    info: items.filter(i => i.severity === 'info').length,
  }), [items]);

  // A filter that survives the list changing under it would show an empty
  // section with no explanation — so it clears itself when it stops matching.
  React.useEffect(() => {
    if (only && counts[only] === 0) setOnly(null);
  }, [only, counts]);

  const shown = only ? items.filter(i => i.severity === only) : items;
  const worst: Severity | null = counts.critical ? 'critical' : counts.warning ? 'warning' : items.length ? 'info' : null;

  return (
    <section className="min-w-0">
      <Head
        title="Needs attention"
        count={items.length || undefined}
        note={
          items.length === 0
            ? undefined
            : worst === 'critical'
              ? 'Most urgent first'
              : 'Nothing critical'
        }
      />

      {items.length === 0 ? (
        /* Earned rather than decorative — every rule found nothing. Worth
           saying plainly; a section that vanishes reads as one that broke. */
        <div className="mt-3 flex items-center gap-3.5 rounded-xl border border-border bg-card px-4 py-5 shadow-e1">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/12 text-success">
            <Check className="size-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-foreground">Nothing needs your attention</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              No overdue work, missed deadlines or approvals waiting on you.
            </p>
          </div>
        </div>
      ) : (
        /*
          In a card, like the panel beside it.

          The queue used to be loose rows on the page background with the
          Upcoming card immediately to its right, so the page's single most
          important list was the one region that looked unfinished — and its
          hairline rules were reading as the page's, not as its own.
        */
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            {FILTERS.filter(f => counts[f.severity] > 0).map(f => (
              <Chip
                key={f.severity}
                label={f.label}
                count={counts[f.severity]}
                tone={f.severity}
                active={only === f.severity}
                onClick={() => setOnly(only === f.severity ? null : f.severity)}
              />
            ))}
            {only ? (
              <button
                type="button"
                onClick={() => setOnly(null)}
                className="text-[11.5px] font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Show all {items.length}
              </button>
            ) : null}
          </div>

          <ul className="p-1.5">
            {shown.map(item => (
              <li key={item.id}>
                <TRow
                  columns={ATTENTION_COLS}
                  onClick={() => onAct(item)}
                  ariaLabel={`${severityWord(item.severity)}. ${item.title}. ${item.state}. ${item.action.label}`}
                  className="py-2.5"
                >
                  <Rail severity={item.severity} />
                  <span className="min-w-0">
                    <span className="line-clamp-2 block text-[13.5px] font-medium leading-snug text-foreground md:truncate">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] leading-snug text-muted-foreground">
                      {item.detail}
                    </span>
                  </span>

                  {/* The condition, as a token rather than as prose: a column
                      of them scans, and it is the answer to "why is this on my
                      list" that the title only implied. */}
                  <span className="hidden md:block">
                    <span
                      className={cn(
                        'inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium',
                        item.severity === 'critical'
                          ? 'bg-destructive/10 text-destructive'
                          : item.severity === 'warning'
                            ? 'bg-warning/12 text-warning'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {item.state}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center justify-end gap-1 text-[12px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                    <span className="hidden truncate sm:inline">{item.action.label}</span>
                    <ArrowRight
                      className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </TRow>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Upcoming                                                                  */
/* -------------------------------------------------------------------------- */
/**
 * One column template for both event bands.
 *
 * Today's rows hold a bare time (`10:00`) and the later ones hold a weekday
 * and a time (`Mon 09:30`), so sizing each band to its own content would put
 * two different left edges either side of a divider inside a single card.
 * Sized for the longer of the two.
 */
const WHEN_COLS = 'grid-cols-[4.5rem_minmax(0,1fr)]';

export function UpcomingSection({
  events,
  tasks,
  checkedInAt,
  onOpenCalendar,
  onOpenTask,
}: {
  events: DashboardEvent[];
  tasks: DashboardTask[];
  checkedInAt: string | null;
  onOpenCalendar: () => void;
  onOpenTask: ((id: string) => void) | null;
}) {
  /**
   * ── Today, and then what is coming ────────────────────────────────────────
   *
   * `later` used to be a *fallback*: it was rendered only when today was
   * empty, so on any day with a meeting in it the other six days the endpoint
   * had already fetched were thrown away. The one question this column exists
   * to answer — what is coming next — went unanswered precisely on the busy
   * days when it is worth asking, and the panel ended a third of the way down
   * a column it was supposed to fill.
   *
   * Both bands now render. The data was always there; nothing extra is
   * fetched for this.
   */
  const today = events.filter(e => isToday(e.startsAt)).slice(0, 3);
  const later = events.filter(e => !isToday(e.startsAt)).slice(0, 3);
  const next = tasks.filter(t => !t.overdue).slice(0, 3);

  return (
    <section className="min-w-0">
      <Head
        title="Upcoming"
        count={today.length || undefined}
        note={today.length ? 'today' : 'Nothing today'}
        action={{ label: 'Calendar', onClick: onOpenCalendar }}
      />

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
        {checkedInAt ? (
          <p className="border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
            Clocked in at{' '}
            <span className="font-medium tabular-nums text-foreground">{timeOf(checkedInAt)}</span>
          </p>
        ) : null}

        {today.length === 0 && later.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted-foreground">
            Nothing in the next seven days.
          </p>
        ) : null}

        {today.length > 0 ? (
          <ul className="p-1.5">
            {today.map(ev => (
              <li key={ev.id}>
                <TRow columns={WHEN_COLS} className="py-1.5">
                  <span className="text-[12px] font-medium tabular-nums text-muted-foreground">
                    {ev.allDay ? 'All day' : timeOf(ev.startsAt)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {ev.title}
                    </span>
                    {ev.location ? (
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                        {ev.location}
                      </span>
                    ) : null}
                  </span>
                </TRow>
              </li>
            ))}
          </ul>
        ) : null}

        {later.length > 0 ? (
          <>
            {today.length > 0 ? (
              <p className="border-t border-border px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/80">
                Later this week
              </p>
            ) : null}
            <ul className={cn('p-1.5', today.length > 0 && 'pt-0')}>
              {later.map(ev => (
                <li key={ev.id}>
                  <TRow columns={WHEN_COLS} className="py-1.5">
                    <span className="text-[12px] font-medium tabular-nums text-muted-foreground">
                      {formatDate(ev.startsAt, { weekday: 'short' })}
                      {ev.allDay ? '' : ` ${timeOf(ev.startsAt)}`}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {ev.title}
                      </span>
                      {ev.location ? (
                        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                          {ev.location}
                        </span>
                      ) : null}
                    </span>
                  </TRow>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {next.length > 0 ? (
          <>
            <p className="border-t border-border px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/80">
              Your next tasks
            </p>
            <ul className="p-1.5 pt-0">
              {next.map(t => (
                <li key={t.id}>
                  <TRow
                    columns="grid-cols-[minmax(0,1fr)_auto]"
                    onClick={onOpenTask ? () => onOpenTask(t.id) : undefined}
                    className="py-1.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-foreground">{t.title}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                        {[t.projectName, statusLabel(t.status)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {t.dueDate ? (
                      <span className="text-[11.5px] tabular-nums text-muted-foreground">
                        {formatDate(t.dueDate, { day: 'numeric', month: 'short' })}
                      </span>
                    ) : null}
                  </TRow>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Support                                                                   */
/* -------------------------------------------------------------------------- */
export function SupportSection({
  support,
  onOpenSupport,
  onOpenTicket,
}: {
  support: DashboardSupport;
  onOpenSupport: () => void;
  onOpenTicket: (id: string) => void;
}) {
  return (
    <section className="min-w-0">
      {/*
        No count, no note.

        The strip directly below reads OPEN 9 · PAST DUE 5 · RESOLVED 5, and
        the heading was printing two of those three again — "Support 9 · 5 past
        due" — eighteen pixels above them. A section whose own summary repeats
        its own summary is the kind of thing that makes a dense page feel
        padded rather than full. The heading names the subject and offers the
        way in; the strip does the counting.
      */}
      <Head title="Support" action={{ label: 'Support', onClick: onOpenSupport }} />

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
          <Stat label="Open" value={support.open} />
          <Stat
            label="Past due"
            value={support.breached}
            tone={support.breached ? 'critical' : 'default'}
          />
          <Stat label="Resolved" value={support.resolvedThisMonth} tone="success" />
        </div>

        {support.recent.length === 0 ? (
          <p className="px-4 py-5 text-[12.5px] text-muted-foreground">No open tickets.</p>
        ) : (
          <ul className="p-1.5">
            {/*
              The SLA clock, given its own column.

              The row used to end at the subject and put "· past due" at the
              end of a grey subtitle — so the single most operational fact
              about a ticket was set in the quietest type on the panel, and
              the right half of every row was empty. `due_at` is a deadline;
              a deadline deserves a right-aligned, tabular column that a
              reader can run their eye down.
            */}
            {support.recent.slice(0, 4).map(t => {
              const sla = slaIn(t.dueDate);
              const late = !!sla?.over;
              return (
                <li key={t.id}>
                  <TRow
                    columns="grid-cols-[minmax(0,1fr)_auto]"
                    onClick={() => onOpenTicket(t.id)}
                    ariaLabel={`Open ${t.ticketNumber}${sla ? `. Response ${sla.text}` : ''}`}
                    className="py-1.5"
                  >
                    {late || t.priority === 'critical' ? <Rail severity="critical" /> : null}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-foreground">{t.subject}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                        {t.ticketNumber} · {statusLabel(t.priority)}
                      </span>
                    </span>
                    {sla ? (
                      <span className="shrink-0 text-right">
                        <span
                          className={cn(
                            'block text-[12.5px] font-medium tabular-nums',
                            late ? 'text-destructive' : sla.soon ? 'text-warning' : 'text-foreground',
                          )}
                        >
                          {sla.text}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {late ? 'past SLA' : 'to respond'}
                        </span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11.5px] text-muted-foreground/70">No SLA</span>
                    )}
                  </TRow>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stock                                                                     */
/* -------------------------------------------------------------------------- */
export function InventorySection({
  inventory,
  onOpenInventory,
  onOpenProduct,
}: {
  inventory: DashboardInventory;
  onOpenInventory: () => void;
  onOpenProduct: (id: string) => void;
}) {
  return (
    <section className="min-w-0">
      {/*
        The count here was `alerts.length`, so "Stock 5" sat above a strip
        reading PRODUCTS 18 — a number that matched nothing the reader could
        see and quietly contradicted the one beside it. The value on hand is
        the one figure the strip does *not* carry, so it is the one the heading
        keeps.
      */}
      <Head
        title="Stock"
        note={`${money(inventory.stockValue)} on hand`}
        action={{ label: 'Inventory', onClick: onOpenInventory }}
      />

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
        {/* The same three-figure strip Support carries, for the same reason:
            two panels side by side that are built differently read as two
            unrelated widgets, and a panel with one row in it reads as a panel
            that failed to load. */}
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
          <Stat label="Products" value={inventory.products} />
          <Stat
            label="Below reorder"
            value={Math.max(0, inventory.lowStockCount - inventory.outOfStockCount)}
            tone={inventory.lowStockCount > inventory.outOfStockCount ? 'warning' : 'default'}
          />
          <Stat
            label="Out of stock"
            value={inventory.outOfStockCount}
            tone={inventory.outOfStockCount ? 'critical' : 'default'}
          />
        </div>

        {inventory.alerts.length === 0 ? (
          <p className="px-4 py-5 text-[12.5px] text-muted-foreground">
            All {inventory.products} products are above their reorder point.
          </p>
        ) : (
          <ul className="p-1.5">
            {/*
              "8/20" was the whole right-hand column, and it needed a legend.

              What a reorder alert is actually saying is *how far below the
              line this has fallen*, which is a proportion — so it is drawn as
              one, against the reorder level, with the figures spelled out
              beside it. Zero stock draws an empty track rather than a
              zero-width bar, because "nothing left" has to look different
              from "not loaded".
            */}
            {inventory.alerts.slice(0, 4).map(a => {
              const out = a.stock <= 0;
              const share = a.reorderLevel > 0
                ? Math.min(100, (a.stock / a.reorderLevel) * 100)
                : a.stock > 0 ? 100 : 0;
              return (
                <li key={a.id}>
                  <TRow
                    columns="grid-cols-[minmax(0,1fr)_7.5rem]"
                    onClick={() => onOpenProduct(a.id)}
                    ariaLabel={`Open ${a.name}. ${a.stock} of ${a.reorderLevel} ${a.unit ?? ''}`.trim()}
                    className="py-1.5"
                  >
                    <Rail severity={out ? 'critical' : 'warning'} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-foreground">{a.name}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                        {a.sku}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-baseline justify-end gap-1 text-[12.5px] tabular-nums">
                        <span className={cn('font-medium', out ? 'text-destructive' : 'text-foreground')}>
                          {a.stock}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          of {a.reorderLevel}
                        </span>
                      </span>
                      <Meter
                        value={share}
                        tone={out ? 'critical' : 'warning'}
                        className="mt-1.5 h-1"
                      />
                    </span>
                  </TRow>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Activity                                                                  */
/* -------------------------------------------------------------------------- */
/**
 * The verb, drawn rather than written.
 *
 * Every row already carried its module and its age; what it never said was
 * whether something had been *made*, *changed* or *finished*, which is the one
 * distinction that makes a feed skimmable. `action` is on the payload and was
 * being read for exactly one purpose — deciding whether the row could be
 * opened — so this costs nothing new.
 */
const VERB: Record<string, { mark: string; tone: string }> = {
  create: { mark: '+', tone: 'bg-success/12 text-success' },
  update: { mark: '±', tone: 'bg-muted text-muted-foreground' },
  delete: { mark: '−', tone: 'bg-destructive/10 text-destructive' },
};

/** Today, Yesterday, or the date. Used to break the stream into runs. */
function dayBand(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000,
  );
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatDate(iso, { day: 'numeric', month: 'long' });
}

export function ActivitySection({
  activity,
  onOpen,
}: {
  activity: DashboardActivity[];
  onOpen: (a: DashboardActivity) => void;
}) {
  /**
   * Three balanced columns, each carrying its own day headings.
   *
   * ── What was here, and why a busy workspace broke it ──────────────────────
   *
   * The previous version grouped the feed into day bands and made each *band* a
   * grid cell. That is correct only when the days and the columns happen to be
   * the same number. Against a workspace that had actually been running for a
   * year, every one of the eighteen most recent events fell inside two days —
   * which is what a busy company looks like — so the section rendered one very
   * long column, one short one, and eight hundred pixels of empty page. The
   * layout was quietly depending on the workspace being quiet.
   *
   * So the split is by *count* now, into three roughly equal columns, and the
   * day heading is emitted wherever the day changes — including at the top of a
   * column that continues the previous one's day. Reading order is preserved:
   * down the first column, then down the second, which is the order the grid
   * places them in at every breakpoint.
   */
  /**
   * When the whole feed is one day, the heading is hoisted out of the columns.
   *
   * Per-column headings are right when the days actually differ. They are
   * plainly wrong when a busy workspace puts all eighteen events inside a
   * single day and the section renders "YESTERDAY" three times across the
   * page — which reads as a rendering fault rather than as a label.
   */
  const singleDay = React.useMemo(() => {
    const days = new Set(activity.slice(0, 18).map(a => dayBand(a.createdAt)));
    return days.size === 1 ? [...days][0] : null;
  }, [activity]);

  const columns = React.useMemo(() => {
    const items = activity.slice(0, 18);
    if (!items.length) return [];

    const per = Math.ceil(items.length / Math.min(3, items.length));
    const chunks: DashboardActivity[][] = [];
    for (let i = 0; i < items.length; i += per) chunks.push(items.slice(i, i + per));

    // Each column becomes its own list of day bands, so a day that spans two
    // columns is labelled in both rather than orphaning the second.
    return chunks.map(chunk => {
      const bands: { day: string; items: DashboardActivity[] }[] = [];
      for (const a of chunk) {
        const day = dayBand(a.createdAt);
        const last = bands[bands.length - 1];
        if (last && last.day === day) last.items.push(a);
        else bands.push({ day, items: [a] });
      }
      return bands;
    });
  }, [activity]);

  return (
    <section className="min-w-0">
      <Head
        title="Recent activity"
        note={singleDay ? `${singleDay.toLowerCase()} · across the modules you can open` : 'Across the modules you can open'}
      />

      {activity.length === 0 ? (
        <p className="mt-3 rounded-xl border border-border bg-card px-4 py-5 text-[12.5px] text-muted-foreground shadow-e1">
          Nothing recorded yet. Work across the modules you can open appears here.
        </p>
      ) : (
        <div className="mt-3 grid gap-x-10 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
          {columns.map((bands, ci) => (
            <div key={ci} className="min-w-0">
              {bands.map((band, bi) => (
            <div key={band.day + bi} className="min-w-0">
              {singleDay ? null : (
                <p className={cn(
                  'mb-1 pl-3 text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground/85',
                  bi > 0 && 'mt-4',
                )}>
                  {band.day}
                </p>
              )}
              <ul className="-ml-3">
                {band.items.map(a => {
                  // A deleted record has nowhere to go, so it stays a plain row
                  // rather than a link that leads to a 404.
                  const canOpen = a.action !== 'delete' && !!a.entityType && !!a.entityId;
                  const verb = VERB[a.action] ?? VERB.update;
                  return (
                    <li key={a.id}>
                      <TRow
                        columns="grid-cols-[1.75rem_minmax(0,1fr)]"
                        onClick={canOpen ? () => onOpen(a) : undefined}
                        ariaLabel={canOpen ? `Open ${a.title}` : undefined}
                        className="py-1.5"
                      >
                        <span className="relative flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                          {a.user ? getInitials(a.user.firstName, a.user.lastName) : '—'}
                          <span
                            className={cn(
                              'absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full text-[9px] font-bold leading-none ring-2 ring-background',
                              verb.tone,
                            )}
                            aria-hidden="true"
                          >
                            {verb.mark}
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] text-foreground">{a.title}</span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                            {moduleLabel(a.module)} · {formatRelativeTime(a.createdAt)}
                          </span>
                        </span>
                      </TRow>
                    </li>
                  );
                })}
              </ul>
            </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  A workspace with nothing in it yet                                        */
/* -------------------------------------------------------------------------- */
export function GettingStarted({
  steps,
}: {
  steps: { label: string; description: string; onClick: () => void }[];
}) {
  /**
   * ── Sized as product UI, not as a landing page ────────────────────────────
   *
   * This carried a 26px headline under an eleven-pixel eyebrow, which is the
   * proportion of a marketing hero — and on a 1440 screen the sentence broke
   * as "…exactly right on / day one." The writing was the best thing about it
   * and is kept; what changed is the register it is set in. 19px is the size
   * this product gives a statement, and the eyebrow is gone because "Your
   * workspace is ready" was a label above a sentence that said the same thing
   * better.
   *
   * The paragraph lost its last line too — "Start with whichever of these
   * comes first for you" is an instruction for a list that is visibly a list,
   * sitting directly beneath a heading that already says "Start here".
   */
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-e1">
      <div className="max-w-2xl p-6 sm:p-7">
        <h2 className="text-[19px] font-semibold leading-[1.25] tracking-[-0.02em] text-foreground">
          Nothing to report yet — which is exactly right on day one.
        </h2>
        <p className="mt-2.5 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
          This page fills in as the business runs: what needs attention, what changed, and how the
          numbers are moving.
        </p>
      </div>

      {steps.length > 0 ? (
        <>
          <p className="border-t border-border px-6 pb-2.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-muted-foreground/85 sm:px-7">
            Start here
          </p>
          {/*
            A hairline grid, drawn by the gap rather than by borders on each
            cell: `gap-px` over a `bg-border` parent gives exactly one rule
            between any two cells and none at the edges, so an odd number of
            steps cannot leave a stub of border hanging off the last row.
          */}
          <ul className="grid gap-px border-t border-border bg-border sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={s.label} className="bg-card">
                <button
                  type="button"
                  onClick={s.onClick}
                  className="group flex h-full w-full items-center gap-3.5 px-6 py-4 text-left transition-colors hover:bg-accent/60 sm:px-7"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold tabular-nums text-muted-foreground transition-colors group-hover:border-foreground/25 group-hover:text-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-foreground">{s.label}</span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {s.description}
                    </span>
                  </span>
                  <ArrowRight
                    className="size-4 shrink-0 text-muted-foreground/60 transition-all group-hover:translate-x-0.5 group-hover:text-foreground"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Loading                                                                   */
/* -------------------------------------------------------------------------- */
/**
 * The skeleton mirrors the real composition — the plate, then a wide column
 * and a rail — so nothing jumps when the data lands. A skeleton of a different
 * shape makes the load feel longer than it is.
 */
export function DashboardSkeleton() {
  const bar = 'animate-pulse rounded bg-muted';
  const onPanel = 'animate-pulse rounded bg-white/10';

  /** A band divider, in outline — the page's joints load with the page. */
  const band = (
    <div className="mt-12 flex items-center gap-3">
      <div className={cn(bar, 'h-2.5 w-4')} />
      <div className={cn(bar, 'h-2.5 w-20')} />
      <div className="h-px flex-1 bg-border" />
    </div>
  );

  return (
    <div className="flex-1 overflow-auto" aria-busy="true" aria-live="polite">
      <div className="mx-auto max-w-[1560px] p-4 md:p-6 lg:p-8">
        <span className="sr-only">Loading Executive Overview</span>

        {/*
          The plate itself does not pulse — only the bars inside it do.
          `animate-pulse` animates opacity on whatever carries it, so putting it
          on the panel faded the panel: the skeleton's plate rendered as mid
          grey against a near-black real one, and the surface visibly darkened
          at the moment the data landed. The bars are the thing that is
          pending; the surface they sit on is not.
        */}
        <div className="rounded-xl bg-panel px-5 py-5 shadow-e2 sm:px-7 sm:py-6">
          {/* 1 — the context line and its two controls */}
          <div className="flex items-center gap-3">
            <div className={cn(onPanel, 'h-2.5 w-64')} />
            <div className={cn(onPanel, 'ml-auto h-8 w-[5.5rem] rounded-md')} />
            <div className={cn(onPanel, 'h-8 w-16 rounded-md')} />
          </div>

          {/* 2 — the verdict, against the series */}
          <div className="mt-6 grid gap-x-12 gap-y-7 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:items-end">
            <div>
              <div className={cn(onPanel, 'h-6 w-56')} />
              <div className={cn(onPanel, 'mt-2.5 h-3 w-80 max-w-full')} />
              <div className={cn(onPanel, 'mt-7 h-2.5 w-36')} />
              <div className={cn(onPanel, 'mt-3 h-10 w-52')} />
            </div>
            <div className={cn(onPanel, 'hidden h-[74px] rounded-lg lg:block')} />
          </div>

          {/* 3 — the readout strip.
              Flex below `xl` and a divided grid at it, matching the real one
              exactly: a skeleton whose columns break at a different width than
              the content is a skeleton that makes the page jump when the data
              lands, which is the one thing it exists to prevent. */}
          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-6 border-t border-panel-line pt-5 xl:grid xl:grid-cols-5 xl:gap-x-0 xl:gap-y-0 xl:divide-x xl:divide-panel-line">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="min-w-[9rem] grow basis-[calc(33%-1.5rem)] xl:px-5 xl:first:pl-0">
                <div className={cn(onPanel, 'h-2.5 w-20')} />
                <div className={cn(onPanel, 'mt-2.5 h-5 w-24')} />
                <div className={cn(onPanel, 'mt-3.5 h-[3px] w-full rounded-full')} />
                <div className={cn(onPanel, 'mt-2.5 h-2.5 w-16')} />
              </div>
            ))}
          </div>
        </div>

        {/*
          Below the plate the skeleton mirrors the real composition band for
          band — divider, the money strip over its chart, receivables across
          the page, divider, then the 5/7 split. A skeleton of a different
          shape makes the load feel longer than it is, and a plain block where
          a chart is about to appear makes the chart look like it arrived late.
        */}
        {band}
        <div className="mt-5">
          <div className={cn(bar, 'h-4 w-52')} />
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-2 divide-border border-b border-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-4 py-3.5">
                  <div className={cn(bar, 'h-2.5 w-16')} />
                  <div className={cn(bar, 'mt-2 h-5 w-24')} />
                  <div className={cn(bar, 'mt-2 h-2.5 w-20')} />
                </div>
              ))}
            </div>
            <div className={cn(bar, 'm-1 h-[268px] rounded-lg')} />
          </div>
        </div>

        {/* Receivables: three regions across, not a tall column. */}
        <div className="mt-8">
          <div className={cn(bar, 'h-4 w-32')} />
          <div className={cn(bar, 'mt-3 h-[164px] rounded-xl')} />
        </div>

        {band}
        <div className="mt-5 grid gap-8 xl:grid-cols-12 xl:gap-10">
          <div className="xl:col-span-5">
            <div className={cn(bar, 'h-4 w-44')} />
            <div className={cn(bar, 'mt-3 h-[420px] rounded-xl')} />
          </div>
          <div className="xl:col-span-7">
            <div className={cn(bar, 'h-4 w-32')} />
            <div className={cn(bar, 'mt-3 h-[420px] rounded-xl')} />
          </div>
        </div>
      </div>
    </div>
  );
}
