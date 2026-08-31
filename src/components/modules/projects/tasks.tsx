'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Plus, Search, X, Pencil, Trash2, ExternalLink, CornerDownRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { RecordTable, type Column } from '@/components/shared/record-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { AddToMyWorkItem } from '@/components/shared/add-to-my-work';
import { useModuleRealtime } from '@/hooks/use-realtime';
import { useAppStore } from '@/store/app-store';

import { getList, getOne, remove, patch, hours } from './data';
import { TaskStatusTag, PriorityTag, PersonChip, DueDate, Nothing } from './ui';
import { TaskDialog } from './forms';
import {
  TASK_STATUS_LABELS, PRIORITY_LABELS, PRIORITY_VALUES, type Member, type Task,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Tasks, across every project
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this screen is, and what it is not ──────────────────────────────
 *
 * It is the cross-project view: everything open, everything blocked,
 * everything late, filterable by project, person and status. It is what a
 * delivery lead reads on a Monday.
 *
 * It is **not** anybody's to-do list. That is My Work, which is private,
 * organised by day rather than status, and deliberately kept separate - the
 * two answer different questions and merging them turns a team tracker into a
 * personal one. The bridge between them is one menu item: "Add to My Work"
 * writes a personal item that *points at* the task, and completing that item
 * does not complete this task.
 *
 * ── Mine, by default ─────────────────────────────────────────────────────
 *
 * The endpoint has carried `?assignedToMe=true` since it was written, and no
 * screen in the product has ever sent it - so the only way to find your own
 * work was to filter the whole organisation's tasks by your own name, in a
 * picker that lists everybody. It is a chip now, and the module remembers it.
 */

/**
 * ── Two questions, two controls ──────────────────────────────────────────
 *
 * "Whose is it" and "what state is it in" are independent, and the first
 * version of this screen folded them into one row of chips - Mine, Open,
 * Blocked, Overdue, Everything - which cannot express "my blocked work", the
 * single most useful thing a person opens this list to find. Two controls, no
 * combination unreachable.
 */
type Who = 'mine' | 'everyone';
type State = 'open' | 'overdue' | 'blocked' | 'done' | 'all';

const WHO: { key: Who; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'everyone', label: 'Everyone' },
];

const STATES: { key: State; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
];

export function TasksSection({
  directory, focusTaskId, onFocusHandled, onOpenProject,
}: {
  directory: Member[];
  focusTaskId?: string | null;
  onFocusHandled?: () => void;
  onOpenProject: (id: string) => void;
}) {
  const [rows, setRows] = React.useState<Task[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [projects, setProjects] = React.useState<{ id: string; name: string }[]>([]);

  const [who, setWho] = React.useState<Who>('mine');
  const [state, setState] = React.useState<State>('open');
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(20);
  const [typed, setTyped] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [priority, setPriority] = React.useState('');
  const [sort, setSort] = React.useState('due_date');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Task | null>(null);
  const [deleting, setDeleting] = React.useState<Task | null>(null);
  const [removing, setRemoving] = React.useState(false);

  /**
   * How many rows sit behind each state chip.
   *
   * ── Why five requests and not one aggregate ──────────────────────────────
   *
   * Each count has to be taken under *exactly* the filters the chip would
   * apply, or the number is about a different population from the list it
   * promises. `?pageSize=1` makes every one a single row and a count, the
   * table is already indexed on `(organization_id, status)`, and they go out
   * together - so the cost is one round trip's latency, not five.
   *
   * The alternative was reusing the Delivery screen's totals, which are
   * counted over *live* projects only. A chip reading 93 above a list that can
   * also show work on completed projects is the two-population mistake this
   * module has now made once and fixed twice.
   */
  const [counts, setCounts] = React.useState<Record<State, number> | null>(null);

  const allows = useAppStore(s => s.allows);
  const mayEdit = allows('projects', 'edit');
  const mayDelete = allows('projects', 'delete');

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
      if (projectId) params.set('projectId', projectId);
      if (priority) params.set('priority', priority);
      if (who === 'mine') params.set('assignedToMe', 'true');
      // `state` is answered by the server (see the route's `scope` hook), so
      // the count under the table describes the same population as the rows.
      if (state !== 'all') params.set('state', state);

      const res = await getList<Task>(`/api/projects/tasks?${params}`);
      setRows(res.data);
      setTotal(res.meta?.total ?? res.data.length);
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : 'Could not load tasks');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, pageSize, search, projectId, priority, who, state, sort, sortDir]);

  React.useEffect(() => { load(); }, [load]);

  const countAll = React.useCallback(async () => {
    const base = new URLSearchParams({ page: '1', pageSize: '1' });
    if (search) base.set('search', search);
    if (projectId) base.set('projectId', projectId);
    if (priority) base.set('priority', priority);
    if (who === 'mine') base.set('assignedToMe', 'true');

    try {
      const results = await Promise.all(STATES.map(async st => {
        const params = new URLSearchParams(base);
        if (st.key !== 'all') params.set('state', st.key);
        const res = await getList<Task>(`/api/projects/tasks?${params}`);
        return [st.key, res.meta?.total ?? 0] as const;
      }));
      setCounts(Object.fromEntries(results) as Record<State, number>);
    } catch {
      // A count is a convenience. The table still loads without it, and a
      // toast about a number nobody asked for is noise.
      setCounts(null);
    }
  }, [search, projectId, priority, who]);

  React.useEffect(() => { countAll(); }, [countAll]);

  React.useEffect(() => {
    getList<{ id: string; name: string }>('/api/projects/projects?page=1&pageSize=100')
      .then(r => setProjects(r.data))
      .catch(() => setProjects([]));
  }, []);

  /**
   * `projects` is watched as well as `tasks`, because the Project column
   * renders the project's name - renaming one leaves every row referring to it
   * stale.
   */
  useModuleRealtime('projects-tasks', ['tasks', 'projects'], () => { load(true); countAll(); });

  /**
   * Open a task the palette or a notification found.
   *
   * Fetched by id rather than looked up in `rows`: the list on screen is one
   * page under whatever filters were last set, so the task somebody just
   * searched for is usually not in it. Searching for a record and being told
   * it cannot be found is the worst possible answer.
   */
  React.useEffect(() => {
    if (!focusTaskId) return;
    let cancelled = false;
    (async () => {
      try {
        const task = await getOne<Task>(`/api/projects/tasks/${focusTaskId}`);
        if (!cancelled && task) { setEditing(task); setDialogOpen(true); }
      } catch {
        toast.error('That task could no longer be opened.');
      } finally {
        if (!cancelled) onFocusHandled?.();
      }
    })();
    return () => { cancelled = true; };
  }, [focusTaskId, onFocusHandled]);

  /**
   * Advancing a task from the row menu.
   *
   * The status is the single most-changed field on this screen and it took a
   * dialog, four clicks and a form submit. `done` is offered on everything
   * unfinished and `blocked` on everything not already blocked, because those
   * are the two transitions that other people are waiting to hear about - both
   * fire a notification from the database trigger.
   */
  const setStatus = React.useCallback(async (task: Task, status: string) => {
    try {
      await patch(`/api/projects/tasks/${task.id}`, { status });
      toast.success(status === 'done' ? 'Marked done' : `Moved to ${TASK_STATUS_LABELS[status] ?? status}`);
      load(true);
      countAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the task');
    }
  }, [load, countAll]);

  const confirmDelete = React.useCallback(async () => {
    if (!deleting) return;
    setRemoving(true);
    try {
      await remove(`/api/projects/tasks/${deleting.id}`);
      toast.success('Task deleted');
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setRemoving(false);
    }
  }, [deleting, load]);

  const columns = React.useMemo<Column<Task>[]>(() => [
    {
      key: 'title',
      header: 'Task',
      width: '30%',
      card: 'title',
      cell: t => (
        <span className="flex min-w-0 items-center gap-1.5">
          {/* A subtask says so. Without it a checklist item and the work it
              belongs to are two indistinguishable rows in the same list. */}
          {t.parentTaskId && (
            <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-label="Subtask" />
          )}
          <span className={cn('truncate', t.status === 'done' ? 'text-muted-foreground' : 'font-medium text-foreground')}>
            {t.title}
          </span>
        </span>
      ),
    },
    {
      header: 'Project',
      width: '17%',
      card: 'subtitle',
      cell: t => (t.project
        ? (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onOpenProject(t.project!.id); }}
            className="truncate text-[12.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t.project.name}
          </button>
        )
        : <span className="text-[12.5px] text-muted-foreground/60">Personal</span>),
    },
    {
      key: 'status',
      header: 'Status',
      width: '13%',
      card: 'meta',
      cell: t => <TaskStatusTag status={t.status} />,
    },
    {
      header: 'Assignee',
      width: '16%',
      hide: 'lg',
      cell: t => <PersonChip person={t.assignee} size="xs" muted />,
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '10%',
      hide: 'xl',
      card: 'meta',
      cell: t => <PriorityTag priority={t.priority} />,
    },
    {
      key: 'due_date',
      header: 'Due',
      width: '9%',
      align: 'right',
      card: 'meta',
      cell: t => <DueDate date={t.dueDate} done={t.status === 'done'} />,
    },
    {
      header: 'Hours',
      width: '9%',
      align: 'right',
      hide: 'xl',
      cell: t => (Number(t.estimatedHours) > 0 || Number(t.loggedHours) > 0
        ? (
          <span className="text-[12.5px] tabular-nums text-muted-foreground">
            {hours(t.loggedHours)}<span className="text-muted-foreground/50"> / {hours(t.estimatedHours)}</span>
          </span>
        )
        : <span className="text-[12.5px] text-muted-foreground/50">-</span>),
    },
  ], [onOpenProject]);

  return (
    <div className="nm-enter flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Whose work. Two options, so a segmented control rather than chips. */}
        <div
          role="group"
          aria-label="Whose tasks"
          className="flex items-center rounded-md border border-input p-0.5"
        >
          {WHO.map(w => (
            <button
              key={w.key}
              type="button"
              onClick={() => { setWho(w.key); setPage(0); }}
              aria-pressed={who === w.key}
              className={cn(
                'rounded px-2.5 py-1 text-[12.5px] font-medium transition-colors',
                who === w.key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>

        {/* What state it is in. Answered by the server, not by the page. */}
        <div role="group" aria-label="Task state" className="flex flex-wrap items-center gap-0.5">
          {STATES.map(st => (
            <button
              key={st.key}
              type="button"
              onClick={() => { setState(st.key); setPage(0); }}
              aria-pressed={state === st.key}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                state === st.key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {st.label}
              {counts ? (
                <span className={cn(
                  'ml-1.5 tabular-nums',
                  state === st.key ? 'text-muted-foreground' : 'text-muted-foreground/60',
                )}>
                  {counts[st.key]}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-52 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder="Search tasks"
              aria-label="Search tasks"
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
            value={projectId}
            onChange={e => { setProjectId(e.target.value); setPage(0); }}
            aria-label="Filter by project"
            className="h-9 max-w-[10rem] rounded-md border border-input bg-card px-2 text-[13px] text-foreground"
          >
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <select
            value={priority}
            onChange={e => { setPriority(e.target.value); setPage(0); }}
            aria-label="Filter by priority"
            className="h-9 rounded-md border border-input bg-card px-2 text-[13px] text-foreground"
          >
            <option value="">Any priority</option>
            {PRIORITY_VALUES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>

          <Button
            size="sm" className="h-9 gap-1.5"
            onClick={() => { setEditing(null); setDialogOpen(true); }}
          >
            <Plus className="size-4" /> New task
          </Button>
        </div>
      </div>

      <RecordTable
        columns={columns}
        rows={rows}
        rowKey={t => t.id}
        loading={loading}
        onOpen={t => { setEditing(t); setDialogOpen(true); }}
        sort={sort}
        sortDir={sortDir}
        onSort={(key, dir) => { setSort(key); setSortDir(dir); setPage(0); }}
        page={page}
        pageSize={pageSize}
        total={total}
        onPage={setPage}
        onPageSize={s => { setPageSize(s); setPage(0); }}
        noun="task"
        empty={
          <Nothing
            className="px-5"
            title={
              search || projectId || priority ? 'No tasks match'
                : state === 'blocked' ? `Nothing ${who === 'mine' ? 'of yours ' : ''}is blocked`
                  : state === 'overdue' ? `Nothing ${who === 'mine' ? 'of yours ' : ''}is overdue`
                    : state === 'done' ? 'Nothing finished yet'
                      : who === 'mine' ? 'Nothing open is assigned to you'
                        : 'No open work'
            }
            note={
              search || projectId || priority
                ? 'Clear the search or the filters to see everything.'
                : who === 'mine'
                  ? 'Work assigned to you across every project appears here.'
                  : 'Raise a task, or widen the state filter.'
            }
          />
        }
        actions={t => (
          <>
            {mayEdit && t.status !== 'done' && (
              <DropdownMenuItem onClick={() => setStatus(t, 'done')}>
                Mark done
              </DropdownMenuItem>
            )}
            {mayEdit && t.status !== 'blocked' && t.status !== 'done' && (
              <DropdownMenuItem onClick={() => setStatus(t, 'blocked')}>
                Mark blocked
              </DropdownMenuItem>
            )}
            {mayEdit && t.status === 'blocked' && (
              <DropdownMenuItem onClick={() => setStatus(t, 'in_progress')}>
                Unblock
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { setEditing(t); setDialogOpen(true); }}>
              <Pencil className="mr-2 size-4" /> Open
            </DropdownMenuItem>
            {t.project && (
              <DropdownMenuItem onClick={() => onOpenProject(t.project!.id)}>
                <ExternalLink className="mr-2 size-4" /> Go to the project
              </DropdownMenuItem>
            )}
            {/*
              Intake.

              The task stays the team's source of truth. This puts a *personal*
              item on the reader's own list that points at it, so planning your
              own week does not mean retyping your assignments into a second
              place and letting the two drift. Completing the personal item
              does not complete this task. See `lib/mywork.ts`.
            */}
            <AddToMyWorkItem
              title={t.title}
              source={{
                module: 'projects',
                type: 'task',
                id: t.id,
                label: t.project?.name ?? null,
              }}
            />
            {mayDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleting(t)}
                >
                  <Trash2 className="mr-2 size-4" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      />

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        directory={directory}
        projects={projects}
        defaultProjectId={projectId || null}
        onSaved={() => load()}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Delete this task"
        description={`"${deleting?.title}" will be removed from the project and from its phase.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={removing}
      />
    </div>
  );
}

