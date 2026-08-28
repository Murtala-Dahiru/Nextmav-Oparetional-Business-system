'use client';

import * as React from 'react';
import { RefreshCw, Plus, CircleAlert, ArrowUpRight, ArrowDownRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatNumber, formatDate, formatRelativeTime } from '@/lib/format';
import { useAppStore } from '@/store/app-store';
import { useRealtime } from '@/hooks/use-realtime';
import type { RealtimeStatus } from '@/hooks/use-realtime';
import { roleLabel } from '@/lib/permissions';
import type { Action } from '@/lib/permissions';
import type { ModuleId } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Plate, Trace, Band, Signal, Card } from './primitives';
import type { BarTone } from './primitives';
import { money } from './viz';
import {
  AttentionSection, UpcomingSection, SupportSection, InventorySection,
  ActivitySection, GettingStarted, DashboardSkeleton,
} from './sections';
import { FinancialPerformance, Receivables } from './money';
import { PipelineMomentum } from './pipeline';
import { ProjectHealth, WorkIntelligence } from './delivery';
import { buildAttention, isNewWorkspace } from './attention';
import type { AttentionItem, DashboardData } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Executive Overview — the state of the business, then what to do about it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Two rejected designs, and what each got wrong ─────────────────────────
 *
 * The original was eighteen bordered cards in rows of three — eight KPI tiles,
 * nine panels and a grid of shortcut buttons, each with a coloured icon tile.
 * It held a lot of true information and had no opinion about any of it.
 *
 * The replacement swapped every card for a labelled band of hairline rows and
 * failed the same way one register quieter: an eleven-pixel eyebrow, a rule,
 * two-line rows, repeated eight times down a page that was forty per cent
 * empty in the first viewport. Uniform is uniform whether the unit is a box or
 * a line, and a page with no dominant element has no focal point — which is
 * what "looks like a demo" actually means.
 *
 * ── What this one does instead ────────────────────────────────────────────
 *
 *  1. **A plate in three rows, not a KPI grid on a dark background.** Context
 *     and actions on one quiet line; then the verdict — greeting, summary
 *     sentence, the headline figure at 46px, and that figure's own twelve
 *     months drawn at a size that can be read; then a divided strip of up to
 *     five instruments. Each instrument carries a quantity, its *composition*
 *     as a proportion bar, and whether any of that is trouble. See the note on
 *     the plate for the three faults this replaced.
 *  2. **Type carries the hierarchy.** Six sizes, each with a job the ones
 *     above and below it do not do — see the scale in `primitives.tsx`.
 *  3. **The page has visible joints.** Four `Band` dividers — position,
 *     momentum, delivery, response — so the reader can see where one thought
 *     ends. Ten sections drawn with the same heading and the same card is a
 *     stack of widgets however good each one is, and that is most of what
 *     "looks generated" means once the type and spacing are already right.
 *  4. **Different shapes for different jobs.** The attention queue is a table
 *     with a severity edge. Project health is a table with aligned columns.
 *     Receivables runs across the page in three regions. Support and Stock are
 *     compact panels. Activity is a stream banded by day.
 *
 * ── The order of the page ─────────────────────────────────────────────────
 *
 * Plate → **position** (money in, money owed) → **momentum** (pipeline and the
 * work it creates) → **delivery** (projects, service, stock) → **response**
 * (what needs a person, what is next, what changed). Each movement answers the
 * question the one above it raises.
 *
 * Receivables moved into the first movement in this pass. It had been grouped
 * with Support and Stock by *silhouette* — a figure strip over a short list —
 * which the previous pass admitted in its own comment. Shape is not a subject:
 * money invoiced and money collected are one thought, and it now sits under
 * the chart that explains it.
 *
 * Attention sits in the last movement on purpose, and its count *and severity
 * split* ride in the plate's readout — so the page can be ordered for reading
 * without burying anything urgent two thousand pixels below the fold.
 *
 * ── Partial periods ───────────────────────────────────────────────────────
 *
 * The last month of `revenueByMonth` is normally the month in progress, and
 * the page used to print it, trend it and plot it as though it were complete:
 * on the 28th of a 31-day month a healthy business was told revenue was down a
 * third. `/api/dashboard` now flags that row `current` and sends how far into
 * the month the organisation is, and four places say so — the summary
 * sentence, the headline's note, the trace's dashed tail, and a shaded band
 * on the chart. The weekly completion chart in `delivery.tsx` had solved this
 * for its own current week two passes ago; the money never did.
 *
 * ── What earlier passes fixed, and why they are worth remembering ─────────
 *
 *  1. **Pipeline was counting closed deals as open ones.** The panel and
 *     `company.openDeals` disagreed inside the same payload, and every stage
 *     bar was divided by a total inflated with closed value.
 *  2. **The chart became the thing it was pretending to be.** Two neutral
 *     lines with no range and no colour system are what a plotting library
 *     gives you for free; see the note at the top of `money.tsx`.
 *  3. **The attention queue got a state column and severity counts.** It was
 *     already deciding the right things and saying almost none of them.
 *  4. **"Later this week" appears.** The endpoint had already fetched seven
 *     days of events and the panel threw six of them away on any day that had
 *     a meeting in it.
 *  5. **`v_project_health` stopped being read five columns at a time.** The
 *     view computes blocked tasks, overdue tasks and milestone counts; the
 *     route fetched all of it and mapped a third. "Why is this project at
 *     risk" was unanswerable on a page that had the answer in memory.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * Show a number the endpoint pins to a constant. `finance.pendingExpenseValue`,
 * `hr.newHires`, `projects.totalBudget`, `projects.tasksDueThisWeek`,
 * `company.warehouses`, `crm.leadsByStatus`, `crm.topDeals` and
 * `finance.recentInvoices` are still hard-coded in `/api/dashboard`; the
 * original tiles rendered them as measurements, so every organisation on the
 * platform was told "Nothing overdue" whether or not it was true. They are
 * absent here, and listed as work the API must do first.
 *
 * `finance.overdueCount` and `overdueValue` were on that list until this pass.
 * They are real now, from `v_receivables_ageing` — a view that had existed
 * since migration 0007 and that nothing had ever selected from. Nothing was
 * computed to make them true; the endpoint had been answering zero over the
 * top of numbers the database already held.
 *
 * Nor will it draw a range the data cannot fill. `revenueByMonth` arrives with
 * at most twelve months, so the chart offers only the rungs that window can
 * fill — see `rangesFor` in `money.tsx`.
 *
 * ── The defects this pass fixed ───────────────────────────────────────────
 *
 *  1. **The plate's readout orphaned a cell at every ordinary laptop width.**
 *     The grid only went three, four or five across at `2xl`, so five figures
 *     fell into two columns below that with an empty sixth.
 *  2. **The plate restated the shell header.** Its first line read "EXECUTIVE
 *     OVERVIEW · NORTHWIND STUDIO", forty pixels below a header already saying
 *     "NORTHWIND STUDIO / Executive Overview" — and then a second uppercase
 *     line under that.
 *  3. **Project health listed projects that were not being delivered.**
 *     `v_project_health` has no status filter (deliberately — the projects
 *     module and the reports both read it), and this handler did not add one
 *     while ordering by `days_remaining` ascending. That is the one ordering
 *     that puts *finished* work first: a project completed in March has about
 *     -150 days remaining. Worse, `delayed` was computed as `days_remaining <
 *     0` with no status test, so completed projects were counted as past
 *     deadline and drawn with a red severity rail.
 *  4. **The attention queue carried the same word twice.** Every row had a
 *     module column beside an action label — "Support" next to "Open support"
 *     — costing seven rems from the title, the only cell whose content varies.
 *  5. **Partial months were compared with whole ones.** See above.
 *
 * ── The defect the previous pass fixed, worth remembering ─────────────────
 *
 * `/api/dashboard` used to read `v_finance_monthly` with
 * `.order('period', ascending: true).limit(6)` — the six OLDEST months on
 * record — and then treat the last of them as "this month". Every figure
 * downstream inherited it: `revenueThisMonth`, the trend, the plate's headline
 * and the entire chart. A workspace with a year of invoices was shown its
 * first six months labelled as now.
 *
 * It is invisible for exactly the first six months of a workspace's life,
 * which is how long a demo dataset usually runs — so it survived two design
 * passes over this screen. The route now takes the latest twelve descending
 * and reverses them; see the note there.
 */

/* ── The four numbers the live layer is tuned with ───────────────────────── */

/** The shortest gap between two refetches. See `onLiveChange`. */
const MIN_REFETCH_MS = 4_000;
/** How often to poll when — and only when — the socket cannot deliver. */
const FALLBACK_POLL_MS = 60_000;
/** How old the figures must be before returning to the tab costs a request. */
const STALE_AFTER_MS = 45_000;
/** How long "Updated just now" stays on screen after an update lands. */
const ACKNOWLEDGE_MS = 3_500;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The opening sentence is deliberately assembled from measurements already on
 * the response. It gives the pulse a point of view without turning the page
 * into an invented "AI insight" feed: each clause is a fact the reader can
 * immediately inspect in the section below.
 */
function businessSummary(data: DashboardData): string {
  const facts: string[] = [];
  const { finance, projects, work, crm } = data;

  if (finance?.revenueTrend !== null && finance?.revenueTrend !== undefined) {
    const direction = finance.revenueTrend >= 0 ? 'up' : 'down';
    /* "so far" when the month it is measuring has not finished. Without it
       the opening sentence of the page reports a month-to-date figure against
       a complete month as though the two were the same measurement — which on
       the 28th of a 31-day month is a third of a month of missing revenue
       announced as a decline. */
    const sofar = finance.revenueByMonth.at(-1)?.current ? ' so far' : '';
    facts.push(`Revenue is ${direction} ${Math.abs(finance.revenueTrend)}% from last month${sofar}`);
  }
  if (projects?.delayed) {
    facts.push(`${projects.delayed} ${projects.delayed === 1 ? 'project is' : 'projects are'} past deadline`);
  } else if (projects?.atRisk) {
    facts.push(`${projects.atRisk} ${projects.atRisk === 1 ? 'project needs' : 'projects need'} attention`);
  }
  if (facts.length < 2 && work?.overdueTasks) {
    facts.push(`${work.overdueTasks} ${work.overdueTasks === 1 ? 'task is' : 'tasks are'} overdue`);
  }
  if (facts.length < 2 && crm?.closingThisMonth) {
    facts.push(`${crm.closingThisMonth} ${crm.closingThisMonth === 1 ? 'deal is' : 'deals are'} due to close this month`);
  }

  /*
    The fallback used to read "A live view of the organisation's current
    business signals" — a sentence that describes the page rather than the
    business, in the register of a product tour. It appears on exactly two
    screens: a workspace with nothing in it, and one whose figures are all
    still zero. Both deserve to be told what is true.
  */
  return facts.length
    ? facts.slice(0, 2).join(' · ')
    : 'Nothing to measure yet — the figures fill in as the business runs';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The freshness indicator, which replaced the Refresh button
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A button that says "Refresh" tells the reader two things, and the second one
 * is the problem: *this page may be wrong, and it is your job to fix it*. On a
 * screen whose whole claim is to be the state of the business, that is the
 * wrong contract. So the control is gone and this took its place — not as
 * decoration, but because removing the button without saying anything would
 * leave a reader with no way to know whether they are looking at live figures
 * or a page that quietly stopped receiving twenty minutes ago.
 *
 * It reports one of exactly three honest states:
 *
 *   **Live** — the socket is subscribed and delivering. The dot is the brand
 *   accent. There is no timestamp, because with a working subscription "how
 *   old is this" is not a question the reader has.
 *
 *   **Updated just now** — an update landed in the last few seconds. This is
 *   the acknowledgement that makes a page with no refresh control trustworthy:
 *   something changed, and the screen said so rather than silently redrawing.
 *   It reverts to *Live* on its own.
 *
 *   **Updated 4 minutes ago** — the socket is not delivering, usually because
 *   a proxy blocked the upgrade. No dot, and a real age, because on this path
 *   the figures genuinely have one. The page is polling slowly in the
 *   background; claiming to be live here would be the exact illusion this was
 *   supposed to avoid.
 *
 * `aria-live="polite"` so the change is announced once, quietly, rather than
 * interrupting; `aria-busy` while a fetch is in flight.
 */
function LiveState({
  status, busy, settled, generatedAt,
}: {
  status: RealtimeStatus;
  busy: boolean;
  settled: boolean;
  generatedAt: string;
}) {
  const connected = status === 'subscribed';
  const label = !connected
    ? `Updated ${formatRelativeTime(generatedAt)}`
    : busy ? 'Updating' : settled ? 'Updated just now' : 'Live';

  return (
    <span
      aria-live="polite"
      aria-busy={busy}
      title={
        connected
          ? 'This page updates itself as the business changes.'
          : 'Live updates are unavailable on this network — the figures are being refreshed periodically instead.'
      }
      className="hidden items-center gap-1.5 text-[11px] tabular-nums text-panel-muted sm:flex"
    >
      {connected ? (
        <span className="relative flex size-1.5" aria-hidden="true">
          {/*
            The halo animates only while something is actually happening.
            A dot that pulses for ever is a screensaver; one that pulses when
            an update arrives is feedback. `motion-reduce` drops it entirely —
            the colour alone still carries the state.
          */}
          {busy ? (
            <span className="absolute inset-0 animate-ping rounded-full bg-panel-accent opacity-75 motion-reduce:hidden" />
          ) : null}
          <span className="relative size-1.5 rounded-full bg-panel-accent" />
        </span>
      ) : null}
      {label}
    </span>
  );
}

/**
 * One movement of the page, and its place in the entrance sequence.
 *
 * The animation is defined in `globals.css` and runs exactly once — on mount,
 * when the data replaces the skeleton. It is deliberately *not* the public
 * surface's scroll reveal: on a screen somebody opens several times a day,
 * content that fades in as you reach it means waiting for information that has
 * already arrived. See the note beside `@keyframes nm-enter`.
 *
 * A realtime refetch calls `setData` on nodes that are already mounted, which
 * does not restart a CSS animation, so an update lands in place rather than
 * replaying the page.
 */
function Movement({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <div className="nm-enter" style={{ animationDelay: `${step * 45}ms` }}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Module                                                                    */
/* -------------------------------------------------------------------------- */
export default function DashboardModule() {
  const user = useAppStore(s => s.user);
  const activeRole = useAppStore(s => s.activeRole);
  const allows = useAppStore(s => s.allows);
  const setActiveModule = useAppStore(s => s.setActiveModule);
  const openRecord = useAppStore(s => s.openRecord);

  const [data, setData] = React.useState<DashboardData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [updating, setUpdating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (background = false) => {
    if (background) setUpdating(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load Executive Overview');
      setData(json.data);
      /* Only a *successful* fetch resets the clock. A failed one leaves the
         throttle open so the next event retries immediately rather than
         waiting out an interval it never used. */
      lastLoadAt.current = Date.now();
      if (background) setSettledAt(Date.now());
    } catch (e: any) {
      /**
       * The previous figures are kept on a failed *background* update: a live
       * event that could not be answered should not blank a screen somebody is
       * reading, and the banner says how old the figures are. A failed first
       * load has nothing to keep.
       */
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
      setUpdating(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  /* ══ Live ═══════════════════════════════════════════════════════════════
   *
   * ── Why there is no Refresh button ────────────────────────────────────
   *
   * There was one, and it was an admission that the page could be wrong. A
   * command centre that asks to be re-read is not a command centre; the
   * screen should already be right. Everything below exists to make that
   * true without the reader doing anything, and without pretending.
   *
   * ── What actually drives an update ────────────────────────────────────
   *
   * `postgres_changes` over the Supabase realtime socket — the same
   * replication stream `hooks/use-realtime.ts` was built on and the same one
   * every other module uses. A write anywhere in the platform reaches this
   * tab as a change event, and the page refetches. It is not a timer, and it
   * is not a page reload: no navigation, no remount, scroll position and open
   * menus survive, and the request is silent.
   *
   * The refetch-rather-than-patch decision is argued at length in the hook.
   * The short version for this screen: almost nothing here is a raw row.
   * Revenue, ageing buckets, project progress and the attention queue are all
   * derived — by `v_finance_monthly`, `v_receivables_ageing`,
   * `v_project_health` and `buildAttention` — so merging an event's row into
   * state would move one number and leave every figure computed from it
   * lying. The endpoint is the single source of truth and it is asked again.
   */
  const tables = React.useMemo(() => [
    /* Delivery */
    'projects', 'tasks', 'milestones',
    /* Commercial — `deals` was the significant omission: the entire pipeline
       band, the weighted forecast, the win rate and "won this month" move
       when a deal moves, and none of it updated. */
    'deals', 'leads', 'companies',
    /* Money. `payments` is deliberately absent and still covered: it is not in
       the `supabase_realtime` publication, but `recalculate_invoice()` fires on
       every payment write and UPDATEs the invoice — which is published. The
       event arrives on the row whose figures actually changed. Same for
       `invoice_line_items`. */
    'invoices', 'expenses',
    /* Service, stock, people, calendar */
    'support_tickets', 'products', 'stock_movements',
    'leave_requests', 'attendance_records', 'departments',
    'calendar_events',
    /* The feed itself. */
    'activity_log',
  ], []);

  /**
   * A floor on how often this page may refetch.
   *
   * The hook already debounces 400ms, which collapses a *burst* — the three
   * events one milestone completion fires. This is the other bound: a busy
   * organisation writes `activity_log` on almost every mutation, so without a
   * floor a fifty-person workspace could ask a fairly heavy endpoint (eighteen
   * parallel queries) for the whole payload every couple of seconds, per
   * connected tab.
   *
   * Trailing, never dropping: an event inside the window schedules the fetch
   * for when the window closes rather than discarding it, so the last write
   * always lands. Four seconds is below the threshold at which a person
   * watching two screens notices a lag, and far above the cost of the request.
   */
  const lastLoadAt = React.useRef(0);
  const queued = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const onLiveChange = React.useCallback(() => {
    if (queued.current) return;
    const since = Date.now() - lastLoadAt.current;
    if (since >= MIN_REFETCH_MS) { void load(true); return; }
    queued.current = setTimeout(() => {
      queued.current = null;
      void load(true);
    }, MIN_REFETCH_MS - since);
  }, [load]);

  React.useEffect(() => () => {
    if (queued.current) clearTimeout(queued.current);
  }, []);

  /**
   * A wider debounce than the hook's default, for a page that watches fourteen
   * tables.
   *
   * One user action is not one event here. Raising a support ticket writes the
   * ticket *and* its `activity_log` row, and those two replication events
   * arrive several hundred milliseconds apart — far enough that the default
   * 400ms window closed between them and the page fetched twice for one click.
   * Measured with `leak-test.mjs`: 2 refetches at 400ms, 1 at 1200ms.
   *
   * 1200ms is still well inside the time it takes a person to look up from the
   * module they were working in, and the throttle below is what bounds
   * *sustained* traffic. This bounds the burst.
   */
  const live = useRealtime({
    name: 'module:dashboard',
    tables: React.useMemo(() => tables.map(table => ({ table })), [tables]),
    onChange: onLiveChange,
    debounceMs: 1200,
  });

  /**
   * The degraded path, and the only timer in this file.
   *
   * Websockets are blocked by a good number of corporate proxies — which is
   * precisely the kind of network this product is sold into — and the hook
   * reports that as `unavailable` rather than leaving it to be guessed. With
   * the Refresh button gone, a reader on such a network would otherwise be
   * looking at a page that can never update and has no control to make it.
   *
   * So this polls **only** when the socket is genuinely not delivering, and
   * only while the tab is visible. On a working connection it never runs, and
   * the indicator says which of the two the reader is looking at rather than
   * claiming to be live either way.
   */
  React.useEffect(() => {
    if (live !== 'unavailable') return;
    const tick = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    const t = setInterval(tick, FALLBACK_POLL_MS);
    return () => clearInterval(t);
  }, [live, load]);

  /**
   * Coming back to the tab.
   *
   * A socket that dropped while the tab was hidden reconnects on return, but
   * the events that happened in between are gone — replication is a stream,
   * not a log this client can replay. One request on refocus, and only when
   * the figures are actually old, closes that window. It is not polling: it
   * fires on an interaction, not on a clock.
   */
  React.useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadAt.current < STALE_AFTER_MS) return;
      void load(true);
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  /**
   * "Updated just now", briefly, after an update actually lands.
   *
   * The acknowledgement is the whole reason a person trusts a screen that has
   * no refresh control: something changed, and the page said so. It reverts to
   * the resting state on its own, because a permanent "just now" is a lie
   * within a minute.
   */
  const [settledAt, setSettledAt] = React.useState(0);
  React.useEffect(() => {
    if (!settledAt) return;
    const t = setTimeout(() => setSettledAt(0), ACKNOWLEDGE_MS);
    return () => clearTimeout(t);
  }, [settledAt]);

  // Once a minute, so "updated 4 minutes ago" stays true without a request.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const go = React.useCallback(
    (m: ModuleId) => () => setActiveModule(m),
    [setActiveModule],
  );

  const act = React.useCallback((item: AttentionItem) => {
    if (item.action.record) {
      openRecord(item.action.module, item.action.record.type, item.action.record.id);
    } else {
      setActiveModule(item.action.module);
    }
  }, [openRecord, setActiveModule]);

  if (loading) return <DashboardSkeleton />;

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto p-6">
        <Card className="max-w-md p-7 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-destructive/10">
            <CircleAlert className="size-5 text-destructive" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.015em] text-foreground">
            We couldn’t load the Executive Overview
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
            Nothing has been lost — this is the reading, not your data. Try again, and if it keeps
            failing your administrator will want the line below.
          </p>
          {/* The raw reason, kept rather than swallowed: it is usually the only
              clue a support conversation has, and "there is no data" and "the
              data failed to arrive" are different sentences. */}
          <p className="mt-4 rounded-md border border-border bg-muted/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {error ?? 'The request came back empty.'}
          </p>
          <Button size="sm" className="mt-5 gap-1.5" onClick={() => load()}>
            <RefreshCw className="size-3.5" aria-hidden="true" /> Try again
          </Button>
        </Card>
      </div>
    );
  }

  const {
    viewer, company, crm, finance, projects, myWork, support, hr, inventory,
    calendar, activity, work,
  } = data;

  const attention = buildAttention(data, allows);
  const fresh = isNewWorkspace(data);
  const overdueMine = myWork.tasks.filter(t => t.overdue).length;
  const summary = businessSummary(data);

  /* ── The headline: the one figure this role opens the page for ─────────── */
  const headlineKey = finance ? 'revenue' : crm ? 'pipeline' : 'mine';

  /* Is the figure the headline is about to print a month that has not
     finished? The server decides this; see `current` in `types.ts`. */
  const partialMonth = !!finance?.revenueByMonth.at(-1)?.current;
  const headline = finance
    ? {
        label: 'Revenue this month',
        value: money(finance.revenueThisMonth),
        delta: finance.revenueTrend,
        /**
         * "against last month · 28 of 31 days" rather than "against last
         * month".
         *
         * The figure above it is month-to-date and the comparison divides it
         * by a month that ran its full length, so on the 28th a perfectly
         * healthy business is told revenue is down a third. The arithmetic is
         * correct and the sentence was not, and the fix is not to hide the
         * trend — an executive wants it — but to name the two things being
         * compared. See the note in `/api/dashboard` on `current`.
         */
        note: finance.revenueTrend === null
          ? 'No prior month to compare against'
          : partialMonth && finance.monthToDate
            ? `against last month · ${finance.monthToDate.elapsed} of ${finance.monthToDate.days} days`
            : 'against last month',
        onClick: go('finance'),
      }
    : crm
      ? {
          label: 'Weighted pipeline',
          value: money(crm.weightedPipeline),
          delta: null,
          note: `${company?.openDeals ?? 0} open deals · ${money(crm.pipelineValue)} in total`,
          onClick: go('crm'),
        }
      : {
          label: 'Your open work',
          value: myWork.tasks.length >= 8 ? '8+' : formatNumber(myWork.tasks.length),
          delta: null,
          note: overdueMine
            ? `${overdueMine} overdue`
            : myWork.tasks.length
              ? 'Nothing overdue'
              : 'Nothing assigned to you',
          onClick: allows('mywork') ? go('mywork') : undefined,
        };

  /**
   * The headline's own series, at a size worth reading.
   *
   * This was a 104×32 `Spark` pinned beside the figure, and at that size a
   * twelve-month series is a texture rather than a chart — it cannot be read
   * against itself, so it added confidence without adding information. Given
   * the width the plate was wasting, the same array becomes a real reading:
   * zero-anchored, its peak marked, both ends of its range named.
   *
   * Three months minimum. Two points is a line segment, and a line segment
   * drawn at six hundred pixels claims a trend that two months cannot support.
   */
  const trace = finance && finance.revenueByMonth.length >= 3
    ? {
        values: finance.revenueByMonth.map(m => m.revenue),
        labels: finance.revenueByMonth.map(m => m.month),
      }
    : null;

  /* ── The readout strip ─────────────────────────────────────────────────
     Each signal says three things where the payload can support three: the
     quantity, what it is made of, and whether any of that is trouble.

     The composition bar is only drawn where the parts are *exactly* the
     whole — one query, one population, no arithmetic between two different
     sources. Receivables is `current + overdue = outstanding` from a single
     ageing view; breached tickets are a subset of open ones from a single
     fetch; the attention severities partition one queue. Where that does not
     hold the signal carries a note and no bar, which is why "Active
     projects" has none: `active` is counted by `v_dashboard_stats` over the
     whole organisation while `atRisk` / `delayed` / `onTrack` are counted
     over the six rows of `v_project_health` the route fetches, and those two
     populations are not the same set. A bar whose segments do not add up to
     the number printed above them is worse than no bar at all. */
  type SignalSpec = {
    key: string;
    label: string;
    value: string;
    note?: string;
    noteTone?: 'default' | 'warning' | 'critical' | 'good';
    segments?: { value: number; tone: BarTone; title: string }[];
    onClick?: () => void;
  };

  const signals: SignalSpec[] = [];

  if (crm && headlineKey !== 'pipeline') {
    const rest = Math.max(0, crm.pipelineValue - crm.weightedPipeline);
    const share = crm.pipelineValue > 0
      ? Math.round((crm.weightedPipeline / crm.pipelineValue) * 100)
      : 0;
    signals.push({
      key: 'pipeline',
      label: 'Weighted pipeline',
      value: money(crm.weightedPipeline),
      segments: [
        { value: crm.weightedPipeline, tone: 'accent', title: 'Weighted by probability' },
        { value: rest, tone: 'quiet', title: 'The rest of the open book' },
      ],
      note: `${company?.openDeals ?? 0} open · ${share}% of the book`,
      onClick: go('crm'),
    });
  }

  if (finance) {
    /* `receivables.outstanding` rather than `finance.outstanding`: the first
       is the sum of the same rows the two segments are cut from, the second
       is a separate rollup on `v_dashboard_stats`. They should agree and
       usually do — but the figure printed above a bar has to be the figure
       the bar is drawn from, not a second opinion about it. */
    const r = finance.receivables;
    const overdue = r?.overdueValue ?? finance.overdueValue;
    signals.push({
      key: 'receivables',
      label: 'Receivables',
      value: money(r ? r.outstanding : finance.outstanding),
      segments: r
        ? [
            { value: r.current, tone: 'claim', title: 'Invoiced, not yet due' },
            { value: r.overdueValue, tone: 'bad', title: 'Past the due date' },
          ]
        : undefined,
      note: overdue > 0 ? `${money(overdue)} overdue` : 'All within terms',
      noteTone: overdue > 0 ? 'critical' : 'good',
      onClick: go('finance'),
    });
  }

  if (projects) {
    signals.push({
      key: 'projects',
      label: 'Active projects',
      value: formatNumber(projects.active),
      note: projects.delayed > 0
        ? `${projects.delayed} past deadline`
        : projects.atRisk > 0
          ? `${projects.atRisk} at risk`
          : 'None at risk',
      noteTone: projects.delayed > 0 ? 'critical' : projects.atRisk > 0 ? 'warning' : 'good',
      onClick: go('projects'),
    });
  }

  if (support) {
    signals.push({
      key: 'tickets',
      label: 'Open tickets',
      value: formatNumber(support.open),
      segments: [
        { value: Math.max(0, support.open - support.breached), tone: 'quiet', title: 'Within SLA' },
        { value: support.breached, tone: 'bad', title: 'Past the response deadline' },
      ],
      note: support.breached > 0 ? `${support.breached} past due` : 'All within SLA',
      noteTone: support.breached > 0 ? 'critical' : 'good',
      onClick: go('support'),
    });
  }

  if (signals.length < 4 && headlineKey !== 'mine') {
    const mine = myWork.tasks.length;
    signals.push({
      key: 'mine',
      label: 'Your open work',
      value: mine >= 8 ? '8+' : formatNumber(mine),
      segments: [
        { value: Math.max(0, mine - overdueMine), tone: 'quiet', title: 'On time' },
        { value: overdueMine, tone: 'bad', title: 'Overdue' },
      ],
      note: overdueMine ? `${overdueMine} overdue` : mine ? 'Nothing overdue' : 'Nothing assigned',
      noteTone: overdueMine ? 'critical' : 'default',
      onClick: allows('mywork') ? go('mywork') : undefined,
    });
  }

  if (signals.length < 4 && work) {
    signals.push({
      key: 'work',
      label: 'Open tasks',
      value: formatNumber(work.openTasks),
      segments: [
        { value: Math.max(0, work.openTasks - work.overdueTasks), tone: 'quiet', title: 'On time' },
        { value: work.overdueTasks, tone: 'bad', title: 'Overdue' },
      ],
      note: work.overdueTasks > 0 ? `${work.overdueTasks} overdue` : 'None overdue',
      noteTone: work.overdueTasks > 0 ? 'warning' : 'good',
      onClick: allows('projects') ? go('projects') : undefined,
    });
  }

  if (signals.length < 4 && company && company.headcount > 0) {
    signals.push({
      key: 'team',
      label: 'Team',
      value: formatNumber(company.headcount),
      segments: company.onlineNow > 0
        ? [
            { value: company.onlineNow, tone: 'accent', title: 'Online now' },
            { value: Math.max(0, company.headcount - company.onlineNow), tone: 'quiet', title: 'Away' },
          ]
        : undefined,
      note: company.onlineNow > 0
        ? `${company.onlineNow} online now`
        : `${company.departments} departments`,
      onClick: allows('hr') ? go('hr') : undefined,
    });
  }

  /**
   * The attention count belongs in the first viewport.
   *
   * The full Attention Required section sits low on the page, after the
   * financial and operational bands — which is right for reading order and
   * wrong for urgency: three critical items would otherwise be two thousand
   * pixels below the fold on a laptop. The count rides here instead and
   * scrolls to the section, so the page opens by *saying* how much is wrong
   * without reordering itself around it.
   *
   * The three severities partition the queue exactly, so this is one of the
   * signals that earns a composition bar: the shape of the bar is the shape
   * of the problem before a single row has been read.
   */
  const critical = attention.filter(a => a.severity === 'critical').length;
  const warnings = attention.filter(a => a.severity === 'warning').length;
  const infos = attention.length - critical - warnings;

  if (signals.length < 5 && attention.length > 0) {
    signals.push({
      key: 'attention',
      label: 'Needs attention',
      value: formatNumber(attention.length),
      segments: [
        { value: critical, tone: 'bad', title: 'Critical' },
        { value: warnings, tone: 'warn', title: 'Needs attention' },
        { value: infos, tone: 'quiet', title: 'For information' },
      ],
      note: critical > 0
        ? `${critical} critical`
        : `${attention.length === 1 ? 'item' : 'items'} to review`,
      noteTone: critical > 0 ? 'critical' : 'warning',
      onClick: () => {
        document.getElementById('nm-attention')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    });
  }

  const figures = signals.slice(0, 5);

  /* ── Create shortcuts, filtered to what this role may actually do ─────── */
  const creatable = (
    [
      { label: 'Lead', module: 'crm', where: 'CRM' },
      { label: 'Project', module: 'projects', where: 'Projects' },
      { label: 'Invoice', module: 'finance', where: 'Finance' },
      { label: 'Ticket', module: 'support', where: 'Support' },
      { label: 'Event', module: 'calendar', where: 'Calendar' },
      { label: 'Document', module: 'workspace', where: 'Workspace' },
      { label: 'Leave request', module: 'hr', where: 'HR' },
    ] as { label: string; module: ModuleId; where: string }[]
  ).filter(a => allows(a.module, 'create' as Action));

  const steps = (
    [
      { label: 'Add your first customer', description: 'Leads, contacts and deals live in CRM.', module: 'crm', action: 'create' },
      { label: 'Start a project', description: 'Plan the work and assign the first tasks.', module: 'projects', action: 'create' },
      { label: 'Invite your team', description: 'People, roles and departments.', module: 'admin', action: 'manage' },
      { label: 'Raise an invoice', description: 'Bill a customer and track what is owed.', module: 'finance', action: 'create' },
      { label: 'Write your first page', description: 'Notes, policies and shared documents.', module: 'workspace', action: 'create' },
    ] as { label: string; description: string; module: ModuleId; action: Action }[]
  )
    .filter(s => allows(s.module, s.action))
    .slice(0, 4)
    .map(s => ({ label: s.label, description: s.description, onClick: () => setActiveModule(s.module) }));

  const openTask = allows('projects') ? (id: string) => openRecord('projects', 'task', id) : null;

  /**
   * The compact panels: a figure strip over a short list.
   *
   * This used to be three of them, with Receivables making up the number. It
   * was grouped there by *shape* — the previous pass says so in its own
   * comment — and shape is not a subject: money invoiced belongs with money
   * collected, which is a full page above. Receivables has moved into the
   * first movement, and these two are what genuinely share both a silhouette
   * and a question: *is anything about to stop working*.
   *
   * Filtered rather than conditional so the row's column count follows what a
   * given role can actually see — an employee with no inventory grant gets one
   * panel at full width, not a two-column grid with a hole in it.
   */
  const compact = [
    support ? (
      <SupportSection
        key="support"
        support={support}
        onOpenSupport={go('support')}
        onOpenTicket={id => openRecord('support', 'ticket', id)}
      />
    ) : null,
    inventory ? (
      <InventorySection
        key="stock"
        inventory={inventory}
        onOpenInventory={go('inventory')}
        onOpenProduct={id => openRecord('inventory', 'product', id)}
      />
    ) : null,
  ].filter(Boolean);

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-[1560px] p-4 md:p-6 lg:p-8">
        {/* ══ The plate: where the business stands ═══════════════════════

            Three rows, each with one job.

              1  context and actions — a single quiet line
              2  the verdict — greeting, sentence, headline figure, its series
              3  the readout — up to five instruments in a divided strip

            ── What this replaced, and why ─────────────────────────────────

            The previous plate put the headline in a narrow left column and up
            to five `Display`s in a grid beside it. Three faults, all visible
            at 1440 — which is to say on most of the laptops this product is
            opened on:

              · the grid only went three, four or five across at `2xl`, so at
                every width below that five figures fell into two columns and
                left an empty sixth cell staring back;
              · the headline column was about a third of the plate and mostly
                air, with a 104px sparkline stranded in the middle of it;
              · the eyebrow read "EXECUTIVE OVERVIEW · NORTHWIND STUDIO",
                forty pixels under a shell header already reading "NORTHWIND
                STUDIO / Executive Overview". The plate was spending its most
                valuable line restating the two things the frame had just said,
                and then a second uppercase line under that.

            Rows rather than a grid because a row of five cannot orphan a
            sixth, and the strip can carry however many instruments the role
            turns out to have. */}
        <Plate className="nm-enter px-5 py-5 sm:px-7 sm:py-6">
          {/* ── 1. Context, then the two actions ─────────────────────────
              Everything here is orientation: *when* is this, *who* is asking,
              *how fresh* is it. The workspace and the screen are not repeated
              — the header six lines above owns both. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-medium uppercase tracking-[0.1em] text-panel-muted">
            <span>
              {formatDate(data.generatedAt, { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            <span className="h-2.5 w-px bg-panel-line" aria-hidden="true" />
            <span className="truncate">{viewer?.jobTitle || roleLabel(activeRole)}</span>
            {company && company.headcount > 0 && company.onlineNow > 0 ? (
              <>
                <span className="hidden h-2.5 w-px bg-panel-line sm:block" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {company.onlineNow} of {company.headcount} online
                </span>
              </>
            ) : null}

            <span className="ml-auto flex shrink-0 items-center gap-3 normal-case tracking-normal">
              <LiveState
                status={live}
                busy={updating}
                settled={settledAt > 0}
                generatedAt={data.generatedAt}
              />

              {creatable.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-panel-fg px-3 text-[12.5px] font-semibold text-panel transition-opacity hover:opacity-90"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      New
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={8} className="w-56">
                    <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/75">
                      Create
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {creatable.map(c => (
                      <DropdownMenuItem key={c.label} onSelect={() => setActiveModule(c.module)}>
                        {c.label}
                        {/* Where it will happen, said plainly: this opens the
                            module that owns the record rather than a dialog
                            the dashboard does not own. */}
                        <span className="ml-auto text-[11px] text-muted-foreground">{c.where}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </span>
          </div>

          {/* ── 2. The verdict ───────────────────────────────────────────
              The greeting is a courtesy and is sized like one. The figure is
              the content, and the series beside it is the same figure's own
              history at a size that can actually be read. */}
          {/* The second column exists to hold the series. On day one there is
              no series, and a two-column grid with one empty cell is half a
              dark panel of nothing — so the row is simply one column then. */}
          <div
            className={cn(
              'mt-6 grid gap-x-12 gap-y-7',
              !fresh && trace && 'lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:items-end',
            )}
          >
            <div className="min-w-0">
              <h2 className="text-[21px] font-semibold leading-tight tracking-[-0.02em] text-panel-fg sm:text-[23px]">
                {greeting()}
                {viewer?.firstName || user?.firstName ? `, ${viewer?.firstName ?? user?.firstName}` : ''}
              </h2>
              <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-panel-muted">
                {summary}
              </p>

              {!fresh ? (
                <button
                  type="button"
                  onClick={headline.onClick}
                  disabled={!headline.onClick}
                  className="mt-6 block w-full rounded-md text-left transition-colors hover:bg-white/[0.045] disabled:hover:bg-transparent"
                >
                  <span className="block text-[11px] font-medium uppercase tracking-[0.1em] text-panel-muted">
                    {headline.label}
                  </span>
                  <span className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[42px] font-semibold leading-[1] tabular-nums tracking-[-0.035em] text-panel-fg sm:text-[46px]">
                      {headline.value}
                    </span>
                    {typeof headline.delta === 'number' ? (
                      <span
                        className={cn(
                          'inline-flex items-center gap-0.5 text-[13.5px] font-medium tabular-nums',
                          headline.delta >= 0 ? 'text-panel-accent' : 'text-destructive',
                        )}
                      >
                        {headline.delta >= 0 ? (
                          <ArrowUpRight className="size-4" aria-hidden="true" />
                        ) : (
                          <ArrowDownRight className="size-4" aria-hidden="true" />
                        )}
                        {Math.abs(headline.delta)}%
                      </span>
                    ) : null}
                    <span className="text-[12px] text-panel-muted">{headline.note}</span>
                  </span>
                </button>
              ) : null}
            </div>

            {/*
              The series, given the height of the column it sits in.

              At 74px it was bottom-aligned with the headline and left about
              ninety pixels of dark nothing above it, level with the greeting —
              which is how a plate ends up looking like a KPI strip with a
              decoration in the corner. Filling the column makes it a chart:
              twelve months at 118px can actually be read against itself, which
              is the whole reason it is here rather than a `Spark`.

              Absent for a role whose headline has no history — weighted
              pipeline is a position, not a run — and the grid simply becomes
              one column rather than leaving a hole.
            */}
            {trace && !fresh ? (
              <div className="hidden lg:block">
                <p className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-panel-muted">
                  Collected · last {trace.values.length} months
                  {/* An aside, not a third heading: the same size in the same
                      uppercase tracking made the label read as three titles. */}
                  {partialMonth ? (
                    <span className="text-[11px] normal-case tracking-normal text-panel-muted/70">
                      {' · dashed is month to date'}
                    </span>
                  ) : null}
                </p>
                <Trace
                  values={trace.values}
                  labels={trace.labels}
                  colour="var(--panel-accent)"
                  height={118}
                  format={money}
                  provisional={partialMonth}
                  className="mt-3"
                />
              </div>
            ) : null}
          </div>

          {!fresh ? (
            /* ── 3. The readout ───────────────────────────────────────────
               A divided strip at `xl`, plain columns below it.

               Two separate reasons for that breakpoint, and both matter:
               dividers between *wrapped* rows draw a cross through the middle
               of the block, and at `lg` the strip is only about seven hundred
               pixels wide inside the rail, which leaves 142px a cell — under
               the 168px "WEIGHTED PIPELINE" needs at 10.5px with 0.09em of
               tracking. A label that truncates to "WEIGHTED PIPELIN…" is worse
               than a second row. */
            figures.length > 0 ? (
              <div
                className={cn(
                  /*
                    Flex below `xl`, grid at it.

                    A grid cannot avoid the hole: five instruments in three
                    columns leaves the second row two-thirds full, and at 1180
                    — a very ordinary laptop — the plate ended with an empty
                    cell staring back, which is the exact fault the strip
                    replaced a grid to fix. Flex items grow into the space
                    instead, so the last row is always full whatever the count.

                    At `xl` the whole strip is one row, and only then does the
                    divided-grid treatment apply. `grow`/`basis` are flex-item
                    properties and are simply inert once the parent is a grid,
                    so the children need no reset.
                  */
                  'mt-7 flex flex-wrap gap-x-6 gap-y-6 border-t border-panel-line pt-5',
                  'xl:grid xl:gap-x-0 xl:gap-y-0 xl:divide-x xl:divide-panel-line',
                  figures.length >= 5 ? 'xl:grid-cols-5'
                    : figures.length === 4 ? 'xl:grid-cols-4'
                      : figures.length === 3 ? 'xl:grid-cols-3' : 'xl:grid-cols-2',
                )}
              >
                {figures.map(f => (
                  <Signal
                    key={f.key}
                    label={f.label}
                    value={f.value}
                    note={f.note}
                    noteTone={f.noteTone}
                    segments={f.segments}
                    onClick={f.onClick}
                    className="min-w-[9rem] grow basis-[calc(33%-1.5rem)] rounded-md py-1 xl:px-5 xl:py-1 xl:first:pl-0 xl:last:pr-0"
                  />
                ))}
              </div>
            ) : null
          ) : (
            /*
              ── Day one: the plate is a header, not a padded panel ──────────

              There used to be a rule and a paragraph here, added to stop the
              plate collapsing to "about ninety pixels of dark bar". Against
              the finished screen that reasoning no longer holds: the
              getting-started card sits directly beneath at full width, so a
              compact plate reads as the header of a composed page rather than
              as a panel that failed to load.

              And the paragraph had become a duplicate. It said "No figures
              yet — revenue, pipeline and delivery appear here as soon as
              there is something to measure", a hundred and fifty pixels above
              a card saying "There is nothing to report yet… this page fills in
              as the business runs". Two paragraphs, one thought, one screen.
              The card keeps it, because the card is also where the reader can
              do something about it.
            */
            null
          )}
        </Plate>


        {/* A refresh that failed, over figures that are still good. */}
        {error ? (
          <div
            role="status"
            className="mt-4 flex items-center gap-2.5 rounded-lg border border-warning/30 bg-warning/[0.07] px-4 py-2.5 text-[13px] text-foreground"
          >
            <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {/* Named as what it is now. Nobody asked for this update — a
                  change somewhere in the platform did — so "the last refresh
                  failed" described an action the reader never took. */}
              Live updates hit a problem — {error}. These figures were last updated{' '}
              {formatRelativeTime(data.generatedAt)}.
            </span>
            <button
              type="button"
              onClick={() => load(true)}
              className="shrink-0 text-[12.5px] font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : null}

        {fresh ? (
          <div className="mt-8">
            <GettingStarted steps={steps} />
          </div>
        ) : (
          <>
            {/*
              ══ The order of this page, and why it is now visible ═════════

              Position → momentum → delivery → response. Each movement answers
              the question the one above it raises: *where do we stand*, *what
              is moving toward us*, *is it being built*, *what needs a person
              today*.

              That order was already here and the page could not show it. Ten
              sections drawn with the same heading, the same card and the same
              hairline read as ten widgets stacked in a column, however good
              each one is on its own — and "it looks generated" is very often
              just this: no visible structure above the level of the component.
              `Band` costs one row and gives the page joints.

              Two things moved with the labels, and both are better placed for
              it:

               · **Receivables** left the row of three compact panels. It was
                 grouped there by *shape* — a figure strip over a short list,
                 the same silhouette as Support and Stock — which the previous
                 pass admitted in its own comment. Shape is not a subject.
                 Money invoiced and money collected are one thought, so
                 receivables now sits directly under the chart it explains, at
                 full width and in a horizontal arrangement that uses it.
               · **Support and Stock** are left as a pair rather than a row of
                 three, which gives each of them about five hundred pixels
                 instead of three hundred and fifty, and stops their three-cell
                 figure strips setting at two-line labels.

              Attention still sits in the last movement on purpose, and its
              count and severity split ride in the plate's readout, so nothing
              urgent is hidden by reading order.
            */}

            {/* ══ I · Position ════════════════════════════════════════════ */}
            {finance ? (
              <Movement step={1}>
                <Band
                  index="01"
                  title="Position"
                  note="What the business earned, spent and is still owed"
                  className="mt-10"
                />
                <div className="mt-5">
                  <FinancialPerformance finance={finance} onOpenFinance={go('finance')} />
                </div>
                <div className="mt-8">
                  <Receivables
                    finance={finance}
                    onOpenFinance={go('finance')}
                    onOpenInvoice={allows('finance') ? id => openRecord('finance', 'invoice', id) : null}
                  />
                </div>
              </Movement>
            ) : null}

            {/* ══ II · Momentum ═══════════════════════════════════════════ */}
            {crm || work ? (
              <Movement step={2}>
                <Band
                  index="02"
                  title="Momentum"
                  note="What is coming in, and the work it is creating"
                  className="mt-12"
                />
                <div className="mt-5 grid gap-8 xl:grid-cols-12 xl:gap-10">
                  {crm ? (
                    <div className={work ? 'xl:col-span-5' : 'xl:col-span-12'}>
                      <PipelineMomentum
                        crm={crm}
                        openDeals={company?.openDeals ?? 0}
                        onOpenCrm={go('crm')}
                        onOpenDeal={allows('crm') ? id => openRecord('crm', 'deal', id) : null}
                      />
                    </div>
                  ) : null}
                  {work ? (
                    <div className={crm ? 'xl:col-span-7' : 'xl:col-span-12'}>
                      <WorkIntelligence
                        work={work}
                        projects={projects}
                        onOpenProjects={go('projects')}
                        onOpenProject={allows('projects') ? id => openRecord('projects', 'project', id) : null}
                      />
                    </div>
                  ) : null}
                </div>
              </Movement>
            ) : null}

            {/* ══ III · Delivery ══════════════════════════════════════════ */}
            {projects || compact.length > 0 ? (
              <Movement step={3}>
                <Band
                  index="03"
                  title="Delivery"
                  note="Whether what has been promised is being delivered"
                  className="mt-12"
                />

                {/*
                  Project health keeps the whole page.

                  It is a six-column table. In a seven-of-twelve slot the name
                  column came out around 200px and every row read "Corvo
                  patient po…", "Halden telemetr…", "Internal design s…" — a
                  health table whose subject is unreadable is not a health
                  table.
                */}
                {projects ? (
                  <div className="mt-5">
                    <ProjectHealth
                      projects={projects}
                      onOpenProjects={go('projects')}
                      onOpenProject={id => openRecord('projects', 'project', id)}
                    />
                  </div>
                ) : null}

                {compact.length > 0 ? (
                  <div
                    className={cn(
                      'mt-8 grid gap-8 xl:gap-10',
                      compact.length === 2 ? 'md:grid-cols-2' : 'grid-cols-1',
                    )}
                  >
                    {compact}
                  </div>
                ) : null}
              </Movement>
            ) : null}

            {/* ══ IV · Response ═══════════════════════════════════════════ */}
            <Movement step={4}>
            <Band
              index="04"
              title="Response"
              note="What needs a person today, and what changed while you were away"
              className="mt-12"
            />

            {/*
              Attention against Upcoming at 8/4 rather than run full width. An
              attention row is a short sentence in a `1fr` column: given the
              whole page the titles took about a sixth of their track and left
              three hundred pixels of nothing before the state chip, which is
              the exact fault this queue was rebuilt to fix. Upcoming fills
              that space with the other half of the same question — what needs
              doing, and when.
            */}
            <div className="mt-5 grid gap-8 xl:grid-cols-12 xl:gap-10">
              <div id="nm-attention" className="scroll-mt-6 xl:col-span-8">
                <AttentionSection items={attention} onAct={act} />
              </div>
              <div className="xl:col-span-4">
                <UpcomingSection
                  events={calendar.upcoming}
                  tasks={myWork.tasks}
                  checkedInAt={myWork.attendanceToday?.checkedInAt ?? null}
                  onOpenCalendar={go('calendar')}
                  onOpenTask={openTask}
                />
              </div>
            </div>

            {/* Full width, so three columns of activity get ~400px each and
                stop truncating every title mid-word. */}
            {activity ? (
              <div className="mt-8">
                <ActivitySection
                  activity={activity}
                  onOpen={a => openRecord(a.module as ModuleId, a.entityType!, a.entityId!)}
                />
              </div>
            ) : null}
            </Movement>
          </>
        )}
      </div>
    </div>
  );
}
