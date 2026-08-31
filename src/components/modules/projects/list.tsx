'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Plus, Search, X, LayoutGrid, Rows3, Pencil, Trash2, ExternalLink, Flag,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { RecordTable, type Column } from '@/components/shared/record-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useModuleRealtime } from '@/hooks/use-realtime';
import { useAppStore } from '@/store/app-store';
import { PROJECT_STATUSES } from '@/lib/constants';

import { daysUntil } from '@/lib/format';
import { getList, remove, pct } from './data';
import {
  HealthTag, StatusTag, PriorityTag, Progress, PersonChip, DueDate, Nothing,
  healthReasons, HealthReasons,
} from './ui';
import { ProjectDialog } from './forms';
import {
  PROJECT_STATUS_LABELS, type Member, type PortfolioProject,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Every project, as a list
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Home shows the nine that matter. This is the whole book: searchable,
 * filterable, sortable, and paged by the server.
 *
 * ── Two shapes, one dataset ──────────────────────────────────────────────
 *
 * A table reads down columns and answers "which of these is late". Cards read
 * across and answer "what is this project". Both are legitimate and people
 * genuinely prefer different ones, so the choice is offered and remembered for
 * the session - but the *data* is identical, and the same server contract
 * drives both. The old module offered only cards, which is why finding the one
 * project past its deadline meant reading nine paragraphs.
 *
 * ── Where the numbers come from ──────────────────────────────────────────
 *
 * `/api/projects/projects` merges `v_project_health` into every row, so
 * progress, health and the counts on this screen are the same figures the
 * dashboard, the reports and the client portal read. Nothing here recomputes
 * any of them - the board this replaces derived progress in the browser from
 * `_count.tasks` and a `tasks[]` array that the endpoint never returned, so
 * every project displayed 0 tasks and 0%.
 */

type View = 'table' | 'cards';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  ...PROJECT_STATUSES.map(s => ({ value: s, label: PROJECT_STATUS_LABELS[s] ?? s })),
];

export function ProjectsList({
  directory, focusNewProject, onOpenProject, onNewHandled,
}: {
  directory: Member[];
  /** Set when Home's "New project" was pressed on the way in. */
  focusNewProject?: boolean;
  onOpenProject: (id: string) => void;
  onNewHandled?: () => void;
}) {
  const [rows, setRows] = React.useState<PortfolioProject[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  /**
   * Cards first.
   *
   * A table is the better instrument for "which of these is late" and a card
   * is the better one for "what is this project", and the second question is
   * the one somebody arriving at a project list is usually asking. The table
   * is one control away and the choice is remembered for the session.
   */
  const [view, setView] = React.useState<View>('cards');
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState('');
  const [typed, setTyped] = React.useState('');
  const [status, setStatus] = React.useState('');
  /**
   * Most recently touched first.
   *
   * Not by deadline: the earliest end date in a workspace with any history is
   * a project that finished in January, so a list sorted that way opens on
   * five completed engagements before it reaches anything live. Deadline is
   * one click away in the column header, and the Delivery screen already
   * orders by concern for the people who want that.
   */
  const [sort, setSort] = React.useState('updated_at');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PortfolioProject | null>(null);
  const [deleting, setDeleting] = React.useState<PortfolioProject | null>(null);
  const [removing, setRemoving] = React.useState(false);

  const allows = useAppStore(s => s.allows);
  const mayCreate = allows('projects', 'create');
  const mayEdit = allows('projects', 'edit');
  const mayDelete = allows('projects', 'delete');

  /** Debounced, so a search does not issue a request per keystroke. */
  React.useEffect(() => {
    const t = setTimeout(() => { setSearch(typed); setPage(0); }, 250);
    return () => clearTimeout(t);
  }, [typed]);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page + 1), pageSize: String(pageSize), sort, sortDir,
      });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      const res = await getList<PortfolioProject>(`/api/projects/projects?${params}`);
      setRows(res.data);
      setTotal(res.meta?.total ?? res.data.length);
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : 'Could not load projects');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, pageSize, search, status, sort, sortDir]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!focusNewProject) return;
    setEditing(null);
    setDialogOpen(true);
    onNewHandled?.();
  }, [focusNewProject, onNewHandled]);

  /**
   * Every row shows progress, health and counts computed by
   * `v_project_health`, so the list is stale after a write to any of the four
   * tables that view reads. Silent, because a colleague completing a task
   * should not replace the screen with a skeleton.
   */
  useModuleRealtime('projects-list', ['projects', 'tasks', 'milestones', 'files'], () => load(true));

  const onSort = React.useCallback((key: string, dir: 'asc' | 'desc') => {
    setSort(key); setSortDir(dir); setPage(0);
  }, []);

  const confirmDelete = React.useCallback(async () => {
    if (!deleting) return;
    setRemoving(true);
    try {
      await remove(`/api/projects/projects/${deleting.id}`);
      toast.success(`${deleting.name} deleted`);
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setRemoving(false);
    }
  }, [deleting, load]);

  const columns = React.useMemo<Column<PortfolioProject>[]>(() => [
    {
      key: 'name',
      header: 'Project',
      width: '26%',
      card: 'title',
      cell: p => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-foreground">{p.name}</span>
          <span className="truncate text-[12px] text-muted-foreground">
            {p.client?.name ?? 'Internal'}
          </span>
        </span>
      ),
    },
    {
      header: 'Health',
      width: '14%',
      card: 'meta',
      cell: p => <HealthTag health={p.health} />,
    },
    {
      header: 'Progress',
      width: '16%',
      cell: p => (
        <span className="flex items-center gap-2.5">
          <Progress value={p.progressPct} health={p.health} className="min-w-10 flex-1" />
          <span className="w-9 shrink-0 text-right text-[12.5px] tabular-nums text-foreground">
            {pct(p.progressPct)}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '11%',
      hide: 'lg',
      card: 'meta',
      cell: p => <StatusTag status={p.status} />,
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '10%',
      hide: 'xl',
      cell: p => <PriorityTag priority={p.priority} />,
    },
    {
      header: 'Owner',
      width: '14%',
      hide: 'lg',
      cell: p => <PersonChip person={p.owner} size="xs" muted />,
    },
    {
      key: 'end_date',
      header: 'Deadline',
      width: '11%',
      align: 'right',
      card: 'meta',
      cell: p => (
        <DueDate
          date={p.endDate}
          done={['completed', 'archived', 'cancelled'].includes(p.status)}
        />
      ),
    },
  ], []);

  const empty = (
    <Nothing
      className="px-5"
      title={search || status ? 'No projects match' : 'No projects yet'}
      note={search || status
        ? 'Clear the search or the status filter to see everything.'
        : 'A project is the unit of delivery. Create one to start planning phases and assigning work.'}
      action={mayCreate && !search && !status
        ? <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>New project</Button>
        : undefined}
    />
  );

  return (
    <div className="nm-enter flex flex-col gap-4">
      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            className="h-9 pl-8 pr-8 text-[13px]"
          />
          {typed && (
            <button
              type="button"
              onClick={() => setTyped('')}
              aria-label="Clear the search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0); }}
          aria-label="Filter by status"
          className="h-9 rounded-md border border-input bg-card px-2 text-[13px] text-foreground"
        >
          {STATUS_FILTERS.map(f => (
            <option key={f.value || 'all'} value={f.value}>{f.label}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          {/* Table or cards. Hidden below `sm`, where the table already draws
              itself as cards and offering the choice twice means nothing. */}
          <div className="hidden items-center rounded-md border border-input p-0.5 sm:flex">
            {([['table', Rows3, 'Table'], ['cards', LayoutGrid, 'Cards']] as const).map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                aria-pressed={view === key}
                aria-label={label}
                className={cn(
                  'rounded p-1.5 transition-colors',
                  view === key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>

          {mayCreate && (
            <Button size="sm" className="h-9 gap-1.5" onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="size-4" /> New project
            </Button>
          )}
        </div>
      </div>

      {/* ── The list ───────────────────────────────────────────────────── */}
      {view === 'cards' && !loading && rows.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(p => (
            <ListCard
              key={p.id}
              project={p}
              onOpen={() => onOpenProject(p.id)}
              onEdit={mayEdit ? () => { setEditing(p); setDialogOpen(true); } : undefined}
            />
          ))}
        </div>
      ) : (
        <RecordTable
          columns={columns}
          rows={rows}
          rowKey={p => p.id}
          loading={loading}
          onOpen={p => onOpenProject(p.id)}
          sort={sort}
          sortDir={sortDir}
          onSort={onSort}
          page={page}
          pageSize={pageSize}
          total={total}
          onPage={setPage}
          onPageSize={s => { setPageSize(s); setPage(0); }}
          empty={empty}
          noun="project"
          actions={p => (
            <>
              <DropdownMenuItem onClick={() => onOpenProject(p.id)}>
                <ExternalLink className="mr-2 size-4" /> Open workspace
              </DropdownMenuItem>
              {mayEdit && (
                <DropdownMenuItem onClick={() => { setEditing(p); setDialogOpen(true); }}>
                  <Pencil className="mr-2 size-4" /> Edit details
                </DropdownMenuItem>
              )}
              {mayDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleting(p)}
                  >
                    <Trash2 className="mr-2 size-4" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        />
      )}

      {/* Paging belongs to the table; the card grid borrows the same line. */}
      {view === 'cards' && !loading && total > pageSize && (
        <div className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
          <span className="tabular-nums">
            {page * pageSize + 1}-{Math.min(total, (page + 1) * pageSize)} of {total} projects
          </span>
          <span className="flex gap-1.5">
            <Button
              variant="outline" size="sm" className="h-7 px-2 text-[12px]"
              disabled={page === 0} onClick={() => setPage(page - 1)}
            >
              Back
            </Button>
            <Button
              variant="outline" size="sm" className="h-7 px-2 text-[12px]"
              disabled={(page + 1) * pageSize >= total} onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </span>
        </div>
      )}

      <ProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        directory={directory}
        onSaved={() => load()}
        onDelete={editing && mayDelete ? () => setDeleting(editing) : undefined}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Delete this project"
        description={`"${deleting?.name}" and all of its tasks will be removed. Files and discussion are kept but become unreachable.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={removing}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The card view                                                             */
/* -------------------------------------------------------------------------- */

/**
 * ── What a card has to carry, and what it must not ───────────────────────
 *
 * Nine facts, in the order the questions arrive: what it is called, who it is
 * for, what state it is in, whether it is in trouble, how far along, what it
 * is working towards, who owns it, how many people, and when it is due. The
 * health verdict earns the top-right corner because on a wall of twelve cards
 * it is the only thing the eye should have to hunt for.
 *
 * Left out on purpose: the description (two lines of prose nobody reads on a
 * board), the budget (a figure with no context beside it is not a signal), and
 * the raw task counts (the reasons line already carries the ones that matter).
 * The card this replaces carried all three and gave the priority the same
 * weight as the health verdict.
 *
 * ── The spine ────────────────────────────────────────────────────────────
 *
 * A two-pixel edge down the left in the health colour, so a grid of cards can
 * be read as a distribution before a single word is. It costs no horizontal
 * space and, being a position as much as a colour, survives greyscale.
 */
function ListCard({
  project: p, onOpen, onEdit,
}: {
  project: PortfolioProject;
  onOpen: () => void;
  onEdit?: () => void;
}) {
  const closed = ['completed', 'archived', 'cancelled'].includes(p.status);
  const reasons = healthReasons({
    health: p.health,
    status: p.status,
    endDate: p.endDate,
    daysRemaining: p.daysRemaining,
    overdueTasks: p.overdueTasks,
    overdueMilestones: p.overdueMilestones,
    blockedTasks: p.blockedTasks,
    progressPct: p.progressPct,
    totalMilestones: p.totalMilestones,
    completedMilestones: p.completedMilestones,
    totalTasks: p.totalTasks,
    completedTasks: p.completedTasks,
    pendingDeliverables: p.pendingDeliverables,
  });

  const nextDue = p.nextMilestone ? daysUntil(p.nextMilestone.dueDate) : null;

  return (
    <div
      onClick={e => {
        if ((e.target as HTMLElement).closest('a,button,[role="button"]')) return;
        onOpen();
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card shadow-e1 transition-colors hover:bg-accent/40',
        p.health === 'off_track' ? 'border-destructive/30' : 'border-border',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[2px]"
        style={{ background: HEALTH_SPINE[p.health] }}
      />

      <div className="flex flex-col gap-3.5 p-4 pl-5">
        {/* Name, client, state, verdict. */}
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[14.5px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
              {p.name}
            </h3>
            <p className="mt-1 flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
              <span className="truncate">{p.client?.name ?? 'Internal project'}</span>
              <span aria-hidden="true" className="size-[3px] shrink-0 rounded-full bg-border" />
              <StatusTag status={p.status} className="shrink-0 text-[12px]" />
              {(p.priority === 'high' || p.priority === 'critical') && (
                <>
                  <span aria-hidden="true" className="size-[3px] shrink-0 rounded-full bg-border" />
                  <PriorityTag priority={p.priority} className="shrink-0 text-[12px]" />
                </>
              )}
            </p>
          </div>
          <HealthTag health={p.health} className="shrink-0" />
        </div>

        {/* Progress, and what it is measured against. */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] text-muted-foreground">
              {p.totalMilestones > 0
                ? `${p.completedMilestones} of ${p.totalMilestones} phases`
                : p.totalTasks > 0
                  ? `${p.completedTasks} of ${p.totalTasks} tasks`
                  : 'Nothing planned yet'}
            </span>
            <span className="text-[15px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-foreground">
              {pct(p.progressPct)}
            </span>
          </div>
          <Progress className="mt-2" value={p.progressPct} health={p.health} height={5} />
        </div>

        {/*
          What it is working towards.

          A card that says "62% complete" and stops has told the reader how far
          along the work is and nothing about what it is *for*. The next
          unfinished phase is merged into the list route for this line alone.
        */}
        {p.nextMilestone && !closed && (
          <p className="flex min-w-0 items-center gap-2 text-[12.5px]">
            <Flag className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
            <span className="truncate text-foreground">{p.nextMilestone.name}</span>
            {nextDue !== null && (
              <span className={cn(
                'ml-auto shrink-0 whitespace-nowrap tabular-nums',
                nextDue < 0 ? 'font-medium text-destructive'
                  : nextDue <= 3 ? 'font-medium text-warning'
                    : 'text-muted-foreground',
              )}>
                {nextDue < 0 ? `${Math.abs(nextDue)}d late`
                  : nextDue === 0 ? 'today'
                    : `in ${nextDue}d`}
              </span>
            )}
          </p>
        )}

        <HealthReasons reasons={reasons} />
      </div>

      {/* The foot: who owns it, how many people, when it is due. */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/70 py-2.5 pl-5 pr-4">
        <PersonChip person={p.owner} size="xs" muted />
        <span className="flex shrink-0 items-center gap-3 text-[12px] text-muted-foreground">
          {p.memberCount > 0 && (
            <span className="hidden tabular-nums sm:inline">{p.memberCount + 1} people</span>
          )}
          <DueDate date={p.endDate} done={closed} />
        </span>
      </div>

      {onEdit && (
        <Button
          variant="ghost" size="icon"
          aria-label={`Edit ${p.name}`}
          className="absolute right-2 top-2 size-7 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

/** The spine's colour. Health is the only thing on a card that takes one. */
const HEALTH_SPINE: Record<PortfolioProject['health'], string> = {
  on_track: 'color-mix(in srgb, var(--chart-1) 55%, transparent)',
  at_risk: 'var(--warning)',
  off_track: 'var(--destructive)',
};
