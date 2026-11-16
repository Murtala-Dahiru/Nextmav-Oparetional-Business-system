'use client';

import * as React from 'react';
import './command-centre.css';
import { ExpenseDistribution, ProjectDistribution, SalesOutcomes, ServiceTrend, SupportPriorities, WorkforceSummary, ExecutiveBriefing } from './intelligence';
import { PulseCard, SectionHeading } from './chart-system';
import type { ProjectBand } from './visual-model';
import { RefreshCw, Plus, CircleAlert } from 'lucide-react';

import { formatNumber, formatDate, formatRelativeTime } from '@/lib/format';
import { useAppStore } from '@/store/app-store';
import { useDashboardSync } from './use-dashboard-sync';
import type { RealtimeStatus } from '@/hooks/use-realtime';
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

import { Card } from '@/components/shared/readout/primitives';
import type { BarTone } from '@/components/shared/readout/primitives';
import { money } from '@/components/shared/readout/viz';
import {
  AttentionSection, UpcomingSection, SupportSection, InventorySection,
  ActivitySection, GettingStarted, DashboardSkeleton,
} from './sections';
import { FinancialPerformance, Receivables } from './money';
import { PipelineMomentum } from './pipeline';
import { ProjectHealth, WorkIntelligence } from './delivery';
import { buildAttention, isNewWorkspace } from './attention';
import type { AttentionItem } from './types';

/** Executive Overview: existing operational data in a compact, role-aware workspace. */

/** Connection state is not proof that every source table is published. */
function LiveState({ status, busy, error, generatedAt }: {
  status: RealtimeStatus; busy: boolean; error: string | null; generatedAt: string;
}) {
  const [, tick] = React.useState(0);
  React.useEffect(() => { const timer = setInterval(() => tick(n => n + 1), 60_000); return () => clearInterval(timer); }, []);
  const label = busy ? 'Updating' : error ? 'Sync delayed' : status === 'subscribed' ? 'Auto-sync connected' : status === 'connecting' ? 'Connecting' : 'Periodic sync';
  return <span className="cc-sync-state" role="status" title={`Updated ${formatRelativeTime(generatedAt)}. Changes sync automatically; periodic checks reconcile missed events.`}>
    <span className="cc-sync-dot" data-state={error ? 'error' : status} aria-hidden="true"/>{label}<span className="cc-sync-age"> · Updated {formatRelativeTime(generatedAt)}</span>
  </span>;
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

/* -------------------------------------------------------------------------- */
/*  Module                                                                    */
/* -------------------------------------------------------------------------- */
export default function DashboardModule() {
  const user = useAppStore(s => s.user);
  if (!user) return null;
  // Unmount data, requests and channels before rendering another identity or grant set.
  const scope = `${user.organizationId}:${user.id}:${user.memberId}:${user.role}:${JSON.stringify(user.capabilities)}`;
  return <ScopedDashboard key={scope} organizationId={user.organizationId} memberId={user.memberId ?? null}/>;
}

function ScopedDashboard({ organizationId, memberId }: { organizationId: string; memberId: string | null }) {
  const organizationName = useAppStore(s => s.user?.organizationName);
  const allows = useAppStore(s => s.allows);
  const setActiveModule = useAppStore(s => s.setActiveModule);
  const openRecord = useAppStore(s => s.openRecord);

  const [financialRange, setFinancialRange] = React.useState(12);
  const [projectFilter, setProjectFilter] = React.useState<ProjectBand | null>(null);
  const { data, loading, updating, error, status: live, retry } = useDashboardSync(organizationId, memberId);

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
            Automatic synchronization will retry. You can also retry now or share the error below with your administrator.
          </p>
          {/* The raw reason, kept rather than swallowed: it is usually the only
              clue a support conversation has, and "there is no data" and "the
              data failed to arrive" are different sentences. */}
          <p className="mt-4 rounded-md border border-border bg-muted/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {error ?? 'The request came back empty.'}
          </p>
          <Button size="sm" className="mt-5 gap-1.5" onClick={retry}>
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

  /* ── The headline: the one figure this role opens the page for ─────────── */
  const headlineKey = finance ? 'revenue' : crm ? 'pipeline' : 'mine';

  /* Is the figure the headline is about to print a month that has not
     finished? The server decides this; see `current` in `types.ts`. */
  const partialMonth = !!finance?.revenueByMonth.at(-1)?.current;
  const headline = finance
    ? {
        label: 'Collected this month',
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
          ? 'Payments received · month to date'
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
        { value: Math.max(0, support.open - support.breached), tone: 'quiet', title: 'No recorded deadline breach' },
        { value: support.breached, tone: 'bad', title: 'Past the response deadline' },
      ],
      note: support.breached > 0 ? `${support.breached} past due` : 'No recorded deadline breaches',
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
    <div className="nm-overview flex-1 overflow-auto">
      <div className="nm-overview-content">
        <div className="nm-overview-intro">
          <div>
            <h1>Executive Overview</h1>
            <p>{organizationName && <><strong className="font-medium">{organizationName}</strong><span aria-hidden="true">·</span></>}{formatDate(data.generatedAt, { weekday: 'long', day: 'numeric', month: 'long' })} <span aria-hidden="true">·</span> Business performance & operations</p>
            <p className="nm-updated">Operational metrics are current snapshots</p>
          </div>
          <div className="nm-overview-actions">
            <LiveState status={live} busy={updating} error={error} generatedAt={data.generatedAt} />

            {creatable.length > 0 && <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm"><Plus className="size-3.5" aria-hidden="true" />New</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Create in a module</DropdownMenuLabel><DropdownMenuSeparator />
                {creatable.map(c => <DropdownMenuItem key={c.label} onSelect={() => setActiveModule(c.module)}>{c.label}<span className="ml-auto text-xs text-muted-foreground">{c.where}</span></DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>}
          </div>
        </div>

        {error && <div role="status" className="nm-overview-error">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>Updates are unavailable: {error}. Showing figures from {formatRelativeTime(data.generatedAt)}.</span>
          <Button variant="outline" size="sm" onClick={retry}>Retry</Button>
        </div>}

        <div className="command-toolbar"><div><span className="command-eyebrow">BUSINESS COMMAND CENTRE</span><p>Performance, priorities and the records behind them.</p></div>{finance && <label className="command-range">Financial reporting window<select value={financialRange} onChange={e => setFinancialRange(Number(e.target.value))}><option value={3}>Last 3 calendar months</option><option value={6}>Last 6 calendar months</option><option value={12}>Last 12 calendar months</option></select></label>}</div>
        {!!data.unavailable?.length && <div role="status" className="nm-overview-error">Some intelligence is unavailable or exceeds the safe reporting limit: {data.unavailable.join(', ')}. These totals are withheld. Automatic checks will retry; use the source module for details.</div>}
        {fresh && !data.unavailable?.length ? <GettingStarted steps={steps} /> : <>
          <div className="nm-kpi-grid" style={{ '--kpi-count': figures.length + 1 } as React.CSSProperties} aria-label="Key business metrics">
            <PulseCard label={headline.label} value={headline.value} note={headline.note} comparison={headline.delta} onClick={headline.onClick} history={finance?.revenueByMonth.slice(-6).map(m=>m.revenue)} historyLabel="6 months · latest month partial" />
            {figures.map(f => <PulseCard key={f.key} label={f.label} value={f.value} note={f.note} tone={f.noteTone} segments={f.segments} onClick={f.onClick} history={f.key === 'tickets' ? support?.trend?.slice(-6).map(t=>t.opened) : undefined} historyLabel={f.key === 'tickets' ? 'Opened / month · latest partial' : undefined} />)}
          </div>
          {attention.length > 0 && <a href="#nm-attention" className="cc-attention-link"><CircleAlert size={15} aria-hidden="true"/><strong>{attention.length} business priorities</strong><span>{critical ? `${critical} critical · ` : ''}Review exceptions and assigned actions</span><span aria-hidden="true">↗</span></a>}
          {finance && <div className="cc-section" id="overview-position">
            <SectionHeading index="01" title="Financial intelligence" description="Money received, approved costs and what remains outstanding." meta={`${financialRange} calendar months · ${finance.currency ?? ''}`}/>
            <div className="cc-feature-grid"><div className="nm-analytics-panel cc-finance-feature"><FinancialPerformance finance={finance} range={financialRange} onOpenFinance={go('finance')}/></div><ExpenseDistribution finance={finance} range={financialRange}/></div>
            <div className="nm-analytics-panel cc-section-detail"><Receivables finance={finance} onOpenFinance={go('finance')} onOpenInvoice={allows('finance') ? id=>openRecord('finance','invoice',id) : null}/></div>
          </div>}
          {crm && <div className="cc-section" id="overview-momentum">
            <SectionHeading index="02" title="Sales & customer intelligence" description="Understand the open pipeline and the outcomes behind it." meta="Current pipeline · recorded outcomes"/>
            <p className="text-xs text-muted-foreground">Opportunity amounts use organization currency only. Other currencies remain separate in CRM Pipelines.</p><div className="cc-feature-grid"><div className="nm-analytics-panel cc-sales-feature"><PipelineMomentum crm={crm} openDeals={company?.openDeals ?? 0} onOpenCrm={go('crm')} onOpenDeal={allows('crm') ? id=>openRecord('crm','deal',id) : null}/></div><SalesOutcomes crm={crm}/></div>
          </div>}
          {(projects || work) && <div className="cc-section" id="overview-delivery">
            <SectionHeading index="03" title="Projects & delivery" description="Health of active work, completion momentum and delivery priorities." meta="Current health · 8 weeks of completions"/>
            <div className={projects && work ? 'cc-delivery-grid' : 'cc-single-grid'}>
              {projects && <ProjectDistribution projects={projects} selected={projectFilter} onSelect={setProjectFilter}/>}
              {work && <div className="nm-analytics-panel"><WorkIntelligence work={work} projects={projects} onOpenProjects={go('projects')} onOpenProject={allows('projects') ? id=>openRecord('projects','project',id) : null}/></div>}
            </div>
            {projects && <div className="nm-analytics-panel cc-section-detail"><ProjectHealth projects={projects} filter={projectFilter} onClearFilter={()=>setProjectFilter(null)} onOpenProjects={go('projects')} onOpenProject={id=>openRecord('projects','project',id)}/></div>}
          </div>}
          {(support || hr) && <div className="cc-section">
            <SectionHeading index="04" title="People & service" description="Customer demand, service priorities and authorized workforce context."/>
            {support && <div className="cc-feature-grid"><ServiceTrend support={support}/><SupportPriorities support={support}/></div>}
            <WorkforceSummary data={data}/>
          </div>}
          <div className="cc-section" id="nm-attention">
            <SectionHeading index="05" title="Business exceptions & action centre" description="Recorded issues that need a decision, and work assigned to you." meta="Current priorities"/>
            <div className="cc-actions-grid"><div className="nm-analytics-panel nm-attention-panel"><AttentionSection items={attention} onAct={act}/></div><div className="nm-analytics-panel"><UpcomingSection events={calendar.upcoming} tasks={myWork.tasks} checkedInAt={myWork.attendanceToday?.checkedInAt ?? null} onOpenCalendar={go('calendar')} onOpenTask={openTask}/></div></div>
            {compact.length > 0 && <div className="nm-analytics-pair cc-section-detail">{compact.map((panel,index)=><div className="nm-analytics-panel" key={index}>{panel}</div>)}</div>}
          </div>
          <ExecutiveBriefing data={data}/>
          {activity && <div className="nm-analytics-panel cc-section-detail"><ActivitySection activity={activity} onOpen={a=>openRecord(a.module as ModuleId,a.entityType!,a.entityId!)}/></div>}

        </>}
      </div>
    </div>
  );
}
