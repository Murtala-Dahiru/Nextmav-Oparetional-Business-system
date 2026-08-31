'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Plus, RefreshCw, ArrowRight, Loader2, GanttChartSquare, LayoutGrid,
  BarChart3, Users, AlertTriangle, CalendarClock, Inbox, CheckCircle2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Rail } from '@/components/shared/readout/primitives';
import { formatDay, formatDayShort, relativeDay } from '@/lib/format';

import { getOne } from './data';
import { PersonChip, Nothing, Panel } from './ui';
import { Timeline, UnitGrid, Columns, LoadRows, Runway } from './charts';
import type { PortfolioOverview, PortfolioProject } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Delivery - the way in to Projects
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this screen does not look like the other two ─────────────────────
 *
 * The Executive Overview and CRM Home are built from the same composition: a
 * dark plate carrying one headline figure, a strip of instruments beside it,
 * numbered bands dividing the page below. That is the right shape for their
 * question - *here is one number, here is what it is made of, here is what
 * happened* - and it is the wrong shape for this one.
 *
 * A delivery portfolio has no headline figure. "Eleven projects" is a fact
 * about the list, not about the business, and no single number can say whether
 * the work is going well. What a delivery lead needs to see is **shapes**:
 * which engagements overlap, where today falls inside each of them, whether
 * output is rising or falling, who is carrying the load, and which of it is
 * already late.
 *
 * So this page is a **control room**, not a report. The hero is the portfolio
 * on a time axis - the one thing that is unmistakably about project delivery
 * and appears nowhere else in the product. Under it, three instruments read in
 * any order. Under those, the two queues that need somebody today.
 *
 * It shares the design system and not the composition: the same tokens, the
 * same type scale, the same rule that colour means trouble and nothing else,
 * and the same refusal to draw anything that is not a count of real rows.
 *
 * ── One population ───────────────────────────────────────────────────────
 *
 * Every figure derives from the same `projects` array the endpoint returns -
 * the summary line, the unit grid, the timeline and the queues. The Executive
 * Overview pass found the alternative the hard way: `active` was counted
 * org-wide by one view while `atRisk` was counted over whichever six rows a
 * second query happened to fetch, so a heading and the bar under it described
 * different populations and the arithmetic never closed.
 */

type Lens = 'all' | 'mine' | 'attention';

const LENSES: { key: Lens; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Mine' },
  { key: 'attention', label: 'Needs attention' },
];

export function ProjectsHome({
  onOpenProject, onNewProject, onGoProjects,
}: {
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onGoProjects: () => void;
}) {
  const [data, setData] = React.useState<PortfolioOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [lens, setLens] = React.useState<Lens>('all');
  const [loadedAt, setLoadedAt] = React.useState<Date | null>(null);

  const load = React.useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      setData(await getOne<PortfolioOverview>('/api/projects/overview'));
      setLoadedAt(new Date());
    } catch (e) {
      // A failed background refresh leaves the last good data on screen, which
      // is better than a toast complaining about a page the reader can see.
      if (!silent) toast.error(e instanceof Error ? e.message : 'Could not load the portfolio');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  /**
   * The lens applies to the timeline and the grid, not to the queues.
   *
   * "Show me mine" is a question about which *engagements* to look at. An
   * attention queue filtered to your own projects would quietly hide the
   * blocked task on somebody else's that you are the only person who can
   * unblock, which is the opposite of what a queue is for.
   *
   * Declared before the early returns, because a hook cannot be.
   */
  const projects = data?.projects ?? [];
  const lensed = React.useMemo(() => projects.filter(p => (
    lens === 'mine' ? p.isMine : lens === 'attention' ? p.health !== 'on_track' : true
  )), [projects, lens]);

  /** Worst first, then by deadline. A portfolio sorted by name is an index. */
  const ordered = React.useMemo(() => [...lensed].sort((a, b) => {
    const rank = (p: PortfolioProject) => (p.health === 'off_track' ? 0 : p.health === 'at_risk' ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    // An undated project sorts last: `null` ahead of every real date is how a
    // board of drafts ends up above a delivery that is due on Friday.
    return (a.daysRemaining ?? 99_999) - (b.daysRemaining ?? 99_999);
  }), [lensed]);

  if (loading) return <HomeSkeleton />;

  /**
   * The failure state is framed like the page it replaces.
   *
   * Left loose on the background it read as a fragment of a screen that had
   * half rendered, which is exactly the wrong impression: the request failed,
   * the page knows, and there is a button. This environment's connection to
   * the database drops intermittently, so a reader meets this more often than
   * they should and it needs to look deliberate.
   */
  if (!data) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-e1">
        <Nothing
          className="py-0"
          title="The portfolio could not be loaded"
          note="The request did not come back. Try again, or check that you still have access to this workspace."
          action={<Button size="sm" variant="outline" onClick={() => load()}>Try again</Button>}
        />
      </div>
    );
  }

  const { totals, attention, upcoming, waitingOnClient, recentlyCompleted } = data;

  return (
    <div className="nm-enter flex flex-col gap-5">
      {/* ── The page's own header ──────────────────────────────────────────
          A line of type, not a plate. Everything in it is a count of rows, and
          the ones that mean trouble are the ones that take a colour. */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-foreground">
            Delivery
          </h2>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">
            <Reading value={totals.live} label={totals.live === 1 ? 'project in delivery' : 'projects in delivery'} />
            <Dot />
            <Reading value={totals.active} label="active" />
            {totals.offTrack > 0 && <><Dot /><Reading value={totals.offTrack} label="off track" tone="bad" /></>}
            {totals.atRisk > 0 && <><Dot /><Reading value={totals.atRisk} label="need attention" tone="warn" /></>}
            {totals.overdueTasks > 0 && <><Dot /><Reading value={totals.overdueTasks} label="overdue tasks" tone="warn" /></>}
            {totals.blockedTasks > 0 && <><Dot /><Reading value={totals.blockedTasks} label="blocked" tone="bad" /></>}
            {totals.awaitingClient > 0 && <><Dot /><Reading value={totals.awaitingClient} label="with a client" /></>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {loadedAt && (
            <span className="hidden text-[11.5px] text-muted-foreground/70 sm:inline">
              {formatDay(data.today, { day: 'numeric', month: 'short' })}
              {', '}
              {loadedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <Button
            size="sm" variant="outline"
            onClick={() => load(true)}
            disabled={refreshing}
            className="h-9 gap-1.5"
            aria-label="Refresh the portfolio"
          >
            {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" className="h-9 gap-1.5" onClick={onNewProject}>
            <Plus className="size-4" /> New project
          </Button>
        </div>
      </header>

      {/* ── The hero: the portfolio on a time axis ─────────────────────── */}
      <Panel
        title="Delivery timeline"
        icon={GanttChartSquare}
        note={ordered.length === projects.length
          ? 'Every live project, worst first'
          : `${ordered.length} of ${projects.length} projects`}
        bodyClassName="p-3 sm:p-4"
        control={
          <div className="flex items-center gap-0.5">
            {LENSES.map(l => {
              const n = l.key === 'mine' ? totals.mine
                : l.key === 'attention' ? totals.atRisk + totals.offTrack
                  : projects.length;
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setLens(l.key)}
                  aria-pressed={lens === l.key}
                  className={cn(
                    'rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
                    lens === l.key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {l.label}
                  <span className="ml-1.5 tabular-nums text-muted-foreground/70">{n}</span>
                </button>
              );
            })}
          </div>
        }
        action={{ label: 'All projects', onClick: onGoProjects }}
      >
        {ordered.length === 0 ? (
          <Nothing
            className="py-4"
            title={lens === 'mine' ? 'You are not on any live project' : 'Nothing matches'}
            note={lens === 'mine'
              ? 'Projects you own or have been added to appear here.'
              : 'Everything in delivery is currently on track.'}
          />
        ) : (
          <Timeline projects={ordered} today={data.today} onOpen={onOpenProject} />
        )}
      </Panel>

      {/* ── Three instruments ──────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Portfolio" icon={LayoutGrid} note="One square per project">
          <UnitGrid projects={lensed} onOpen={onOpenProject} />
        </Panel>

        <Panel title="Delivered per week" icon={BarChart3} note="Last twelve weeks">
          <Columns data={data.completionTrend} />
        </Panel>

        <Panel
          title="Who is carrying it"
          icon={Users}
          note={`${totals.openTasks} open across the portfolio`}
        >
          <LoadRows workload={data.workload} unassigned={data.unassignedOpen} />
        </Panel>
      </div>

      {/* ── The two queues that need somebody today ────────────────────── */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel
          title="Needs attention"
          icon={AlertTriangle}
          note={attention.length ? 'Most urgent first' : undefined}
          bodyClassName="p-1.5"
        >
          {attention.length === 0 ? (
            <Nothing
              className="px-2.5 py-3"
              title="Nothing needs attention"
              note="No overdue phases, no blocked work, and every live project has a team and a plan."
            />
          ) : (
            <>
              {attention.slice(0, 7).map((row, i) => (
                <button
                  key={`${row.projectId}-${i}`}
                  type="button"
                  onClick={() => onOpenProject(row.projectId)}
                  className="group relative grid w-full grid-cols-[1fr_auto] items-center gap-x-4 rounded-md py-2.5 pl-4 pr-2.5 text-left transition-colors hover:bg-accent/70"
                >
                  <Rail severity={row.severity === 'critical' ? 'critical' : row.severity === 'high' ? 'warning' : 'info'} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-foreground">{row.title}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{row.detail}</span>
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </button>
              ))}
              {attention.length > 7 && (
                <p className="px-4 py-2 text-[12px] text-muted-foreground">
                  {attention.length - 7} more{' '}
                  {attention.length - 7 === 1 ? 'concern' : 'concerns'} across the portfolio.
                </p>
              )}
            </>
          )}
        </Panel>

        <Panel
          title="The runway"
          icon={CalendarClock}
          note={`Late, and due in the next ${data.horizonDays} days`}
        >
          <Runway items={upcoming} horizonDays={data.horizonDays} onOpen={onOpenProject} />
        </Panel>
      </div>

      {/* ── What is with somebody else, and what has landed ────────────── */}
      {/* `items-start` so a nearly empty panel is its own height rather than
          stretching to match a full one beside it. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel
          title="With the client"
          icon={Inbox}
          note="Deliverables put forward and not yet answered"
          bodyClassName="p-0"
        >
          {waitingOnClient.length === 0 ? (
            <Nothing
              className="px-4 py-3"
              title="Nothing is waiting on a client"
              note="A file shared with a client and marked as a deliverable appears here until they accept it."
            />
          ) : (
            <ul className="divide-y divide-border/70">
              {waitingOnClient.slice(0, 6).map(f => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onOpenProject(f.projectId)}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-foreground">{f.filename}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{f.projectName}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[12px] text-muted-foreground">
                      sent {relativeDay(f.since)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recently delivered"
          icon={CheckCircle2}
          note={`${totals.completedTasks} finished in total`}
          bodyClassName="p-0"
        >
          {recentlyCompleted.length === 0 ? (
            <Nothing
              className="px-4 py-3"
              title="Nothing finished yet"
              note="Completed tasks appear here with the day they were closed."
            />
          ) : (
            <ul className="divide-y divide-border/70">
              {recentlyCompleted.slice(0, 6).map(t => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onOpenProject(t.projectId)}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-foreground">{t.title}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{t.projectName}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {t.by && <PersonChip name={t.by} size="xs" muted className="hidden sm:inline-flex" />}
                      <span className="whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">
                        {formatDayShort(t.at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The summary line                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A figure and its noun, set inline.
 *
 * The alternative was a row of stat cards, which is what the brief asks this
 * page not to be and what these numbers deserve least: they are context for
 * the instruments below, not the subject of the screen. Set as a sentence they
 * cost one line; as cards they would cost a hundred and twenty pixels and push
 * the timeline below the fold.
 */
function Reading({
  value, label, tone = 'plain',
}: {
  value: number;
  label: string;
  tone?: 'plain' | 'warn' | 'bad';
}) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className={cn(
        'text-[14px] font-semibold tabular-nums',
        tone === 'bad' ? 'text-destructive' : tone === 'warn' ? 'text-warning' : 'text-foreground',
      )}>
        {value}
      </span>
      <span className={tone === 'plain' ? undefined : 'text-foreground/70'}>{label}</span>
    </span>
  );
}

function Dot() {
  return <span aria-hidden="true" className="size-[3px] rounded-full bg-border" />;
}

/* -------------------------------------------------------------------------- */
/*  Loading                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Shaped like the page it precedes, not like a generic list.
 *
 * The timeline's height depends on how many projects there are, which is not
 * known yet, so it reserves eight rows - a median portfolio - rather than a
 * fixed block that will be the wrong size whichever number arrives.
 */
function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="h-5 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-e1">
        <div className="mb-4 h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[11rem_1fr] items-center gap-3">
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${55 + (i % 4) * 11}%` }} />
              <div
                className="h-5 animate-pulse rounded bg-muted"
                style={{ marginLeft: `${(i * 7) % 40}%`, width: `${30 + (i % 3) * 15}%` }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
