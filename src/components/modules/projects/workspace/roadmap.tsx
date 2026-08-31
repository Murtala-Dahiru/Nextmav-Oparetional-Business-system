'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, Loader2, ChevronRight, ChevronUp, ChevronDown, MoreHorizontal,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Head } from '@/components/shared/readout/primitives';
import { formatDay, daysUntil, todayISO } from '@/lib/format';
import { ROADMAP_STAGES } from '@/lib/constants';
import { useAppStore } from '@/store/app-store';

import { post, patch, remove } from '../data';
import {
  StageTag, stageInk, Progress, PersonChip, DueDate, TaskStatusTag, Nothing,
} from '../ui';
import { STAGE_LABELS, type Member, type Milestone, type Workspace, type WorkspaceTask } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Roadmap - the plan, in the order it happens
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this stopped being ──────────────────────────────────────────────
 *
 * A six-column Kanban board, one column per `stage`, every column always
 * drawn. Three things were wrong with it, and all three came from the same
 * mistake - treating `stage` as a *position* rather than as a label.
 *
 *   · A roadmap is a sequence in time, and a board is a sequence in space
 *     with no time in it at all. Phases carry `start_date` and `due_date`;
 *     the board showed neither except as a line of small grey text.
 *   · Six columns on a 1440px screen are 200px each, so a phase name wrapped
 *     to three lines while five of the six columns were empty - and they were
 *     always empty, because most projects use two or three stages.
 *   · `sort_order` is what puts a roadmap in the order somebody wrote it, and
 *     it is what the template creator carefully sets when it creates phases
 *     one at a time. A board grouped by stage discards it entirely.
 *
 * So the roadmap is now a sequence: the plan against the calendar at the top,
 * then the phases in plan order, each opening to the work filed under it.
 *
 * ── Progress on a phase ──────────────────────────────────────────────────
 *
 * `milestones.progress_pct` has a column, a CHECK constraint and a place in
 * the blended progress figure (a phase in flight counts half of what it
 * claims), and no screen has ever set it. It is editable here, alongside the
 * *observed* completion of the tasks filed under the phase - which is a
 * different number, and worth seeing beside it.
 */

export function RoadmapPanel({
  projectId, data, directory, onChanged, onAddTask,
}: {
  projectId: string;
  data: Workspace;
  directory: Member[];
  onChanged: () => void;
  onAddTask: (milestoneId: string | null) => void;
}) {
  const { milestones, tasks } = data;
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Milestone | null>(null);
  const [deleting, setDeleting] = React.useState<Milestone | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);

  const allows = useAppStore(s => s.allows);
  const mayEdit = allows('projects', 'edit');
  const mayDelete = allows('projects', 'delete');

  const today = todayISO();

  const tasksByPhase = React.useMemo(() => {
    const map = new Map<string, WorkspaceTask[]>();
    for (const t of tasks) {
      const key = t.milestoneId ?? '_none';
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const unphased = tasksByPhase.get('_none') ?? [];

  /**
   * The current phase.
   *
   * The first one that is not finished. Not "the one whose dates contain
   * today", because a project running late has no phase containing today and
   * would show nothing as current at exactly the moment somebody needs to know
   * where it has got to.
   */
  const currentId = milestones.find(m => !m.completedAt)?.id ?? null;

  const toggle = React.useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /**
   * Completing a phase.
   *
   * Sends `completed: true` and lets the server stamp the time. A client
   * choosing the moment would let a roadmap be backdated, and the completion
   * notification the team receives reads that timestamp.
   */
  const setComplete = React.useCallback(async (m: Milestone) => {
    setBusy(m.id);
    try {
      await patch(`/api/projects/milestones/${m.id}`, { completed: !m.completedAt });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the phase');
    } finally {
      setBusy(null);
    }
  }, [onChanged]);

  /**
   * Reordering.
   *
   * Two rows swap their `sort_order`, which is the column the roadmap is read
   * in and the one the template creator sets deliberately. Buttons rather than
   * drag: a drag target inside a list that also expands on click is ambiguous
   * on a mouse and impossible on a phone, and reordering a roadmap is a rare,
   * deliberate act rather than a fluid one.
   */
  const move = React.useCallback(async (index: number, direction: -1 | 1) => {
    const a = milestones[index];
    const b = milestones[index + direction];
    if (!a || !b) return;
    setBusy(a.id);
    try {
      await Promise.all([
        patch(`/api/projects/milestones/${a.id}`, { sortOrder: b.sortOrder }),
        patch(`/api/projects/milestones/${b.id}`, { sortOrder: a.sortOrder }),
      ]);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reorder the plan');
    } finally {
      setBusy(null);
    }
  }, [milestones, onChanged]);

  const confirmDelete = React.useCallback(async () => {
    if (!deleting) return;
    try {
      await remove(`/api/projects/milestones/${deleting.id}`);
      toast.success('Phase removed. Its tasks were kept.');
      setDeleting(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  }, [deleting, onChanged]);

  if (milestones.length === 0) {
    return (
      <>
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-8">
          <Nothing
            className="py-0"
            title="No roadmap yet"
            note="Break the project into phases so progress is measured against the plan rather than a task count. Phases are half of the progress figure as soon as the first one exists."
            action={mayEdit
              ? (
                <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setDialogOpen(true); }}>
                  <Plus className="size-4" /> Add the first phase
                </Button>
              )
              : undefined}
          />
        </div>
        <PhaseDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          projectId={projectId}
          editing={editing}
          directory={directory}
          nextOrder={0}
          onSaved={onChanged}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ScheduleStrip milestones={milestones} project={data.project} today={today} />

      <section className="flex flex-col gap-3">
        <Head
          title="Phases"
          count={milestones.length}
          note={`${milestones.filter(m => m.completedAt).length} complete`}
          action={mayEdit
            ? { label: 'Add phase', onClick: () => { setEditing(null); setDialogOpen(true); } }
            : undefined}
        />

        <ol className="flex flex-col gap-2">
          {milestones.map((m, index) => {
            const phaseTasks = tasksByPhase.get(m.id) ?? [];
            const done = phaseTasks.filter(t => t.status === 'done').length;
            const overdue = !m.completedAt && m.dueDate && m.dueDate < today;
            const current = m.id === currentId;
            const open = expanded.has(m.id);

            return (
              <li
                key={m.id}
                className={cn(
                  'overflow-hidden rounded-xl border bg-card shadow-e1 transition-colors',
                  overdue ? 'border-destructive/40'
                    : current ? 'border-foreground/25'
                      : 'border-border',
                )}
              >
                <div className="flex items-start gap-3 p-4">
                  {mayEdit ? (
                    <Checkbox
                      checked={!!m.completedAt}
                      disabled={busy === m.id}
                      onCheckedChange={() => setComplete(m)}
                      className="mt-0.5 shrink-0"
                      aria-label={m.completedAt ? `Reopen ${m.name}` : `Mark ${m.name} complete`}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-1 size-3 shrink-0 rounded-full border',
                        m.completedAt ? 'border-transparent' : 'border-border',
                      )}
                      style={m.completedAt ? { background: stageInk('completed') } : undefined}
                    />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <button
                        type="button"
                        onClick={() => toggle(m.id)}
                        aria-expanded={open}
                        className="group inline-flex min-w-0 items-center gap-1.5 text-left"
                      >
                        <ChevronRight
                          className={cn(
                            'size-3.5 shrink-0 text-muted-foreground transition-transform',
                            open && 'rotate-90',
                          )}
                          aria-hidden="true"
                        />
                        <span className={cn(
                          'truncate text-[14px] font-semibold tracking-[-0.01em]',
                          m.completedAt ? 'text-muted-foreground line-through' : 'text-foreground',
                        )}>
                          {m.name}
                        </span>
                      </button>
                      {current && !m.completedAt && (
                        <span className="rounded bg-foreground px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.06em] text-background">
                          Current
                        </span>
                      )}
                      <StageTag stage={m.stage} />
                    </div>

                    {m.description && (
                      <p className="mt-1 line-clamp-2 max-w-prose text-[12.5px] text-muted-foreground">
                        {m.description}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
                      {m.owner?.profiles?.fullName
                        ? <PersonChip person={m.owner} size="xs" muted />
                        : <span className="text-muted-foreground/60">No owner</span>}
                      {/*
                        A range only when there is a range, and the due date
                        only once.

                        Most phases in practice carry a due date and no start,
                        so this read "? to 15 May" followed by "due 15 May" -
                        a rendering fault and a repetition in the same line.
                        `DueDate` below carries the date on its own whenever
                        there is no span to draw, and it is the component that
                        knows how to say "18d late".
                      */}
                      {m.startDate && m.dueDate ? (
                        <span className="tabular-nums">
                          {formatDay(m.startDate, { day: 'numeric', month: 'short' })}
                          {' to '}
                          {formatDay(m.dueDate, { day: 'numeric', month: 'short' })}
                        </span>
                      ) : m.startDate ? (
                        <span className="tabular-nums">
                          From {formatDay(m.startDate, { day: 'numeric', month: 'short' })}
                        </span>
                      ) : null}
                      {phaseTasks.length > 0 && (
                        <span>{done} of {phaseTasks.length} tasks</span>
                      )}
                      {m.dueDate && (
                        <DueDate date={m.dueDate} prefix="due" done={!!m.completedAt} />
                      )}
                    </div>

                    {/*
                      Two numbers, deliberately.

                      The claim is `progress_pct` - what the phase owner says.
                      The observation is the share of its tasks that are done.
                      They are different measurements and a roadmap that
                      averaged them would hide the case worth seeing: a phase
                      reported at 80% with two of nine tasks finished.
                    */}
                    {/*
                      The meters are sized, not stretched.

                      Given `flex-1` these two each took half the row, so on a
                      wide screen the label sat four hundred pixels from the bar
                      it belonged to and the pair read as two unrelated things
                      at opposite ends of the phase. A meter is legible at about
                      fourteen rems and gains nothing after that.
                    */}
                    {!m.completedAt && (m.progressPct > 0 || phaseTasks.length > 0) && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">
                        {m.progressPct > 0 && (
                          <span className="flex w-full max-w-[14rem] items-center gap-2">
                            <Progress value={m.progressPct} height={3} className="flex-1" />
                            <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                              {m.progressPct}% reported
                            </span>
                          </span>
                        )}
                        {phaseTasks.length > 0 && (
                          <span className="flex w-full max-w-[14rem] items-center gap-2">
                            <Progress
                              value={(done / phaseTasks.length) * 100}
                              height={3}
                              className="flex-1"
                            />
                            <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                              {Math.round((done / phaseTasks.length) * 100)}% of tasks
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center">
                    {mayEdit && (
                      <div className="hidden flex-col sm:flex">
                        <button
                          type="button"
                          disabled={index === 0 || busy === m.id}
                          onClick={() => move(index, -1)}
                          aria-label={`Move ${m.name} earlier`}
                          className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-25"
                        >
                          <ChevronUp className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={index === milestones.length - 1 || busy === m.id}
                          onClick={() => move(index, 1)}
                          aria-label={`Move ${m.name} later`}
                          className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-25"
                        >
                          <ChevronDown className="size-3.5" />
                        </button>
                      </div>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${m.name}`}>
                          {busy === m.id
                            ? <Loader2 className="size-4 animate-spin" />
                            : <MoreHorizontal className="size-4" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {mayEdit && (
                          <DropdownMenuItem onClick={() => { setEditing(m); setDialogOpen(true); }}>
                            <Pencil className="mr-2 size-4" /> Edit phase
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => onAddTask(m.id)}>
                          <Plus className="mr-2 size-4" /> Task in this phase
                        </DropdownMenuItem>
                        {mayDelete && (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleting(m)}
                          >
                            <Trash2 className="mr-2 size-4" /> Remove
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {open && (
                  <div className="border-t border-border/70 bg-muted/25">
                    {phaseTasks.length === 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <p className="text-[12.5px] text-muted-foreground">
                          Nothing is filed under this phase yet.
                        </p>
                        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => onAddTask(m.id)}>
                          <Plus className="size-3.5" /> Add a task
                        </Button>
                      </div>
                    ) : (
                      <>
                        <ul className="divide-y divide-border/50">
                          {phaseTasks.map(t => (
                            <li key={t.id} className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-2.5">
                              <span className="min-w-0 truncate text-[12.5px] text-foreground">
                                {t.title}
                              </span>
                              <span className="flex shrink-0 items-center gap-4">
                                <TaskStatusTag status={t.status} />
                                <PersonChip person={t.assignee} size="xs" muted className="hidden md:inline-flex" />
                                <DueDate date={t.dueDate} done={t.status === 'done'} />
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div className="px-4 py-2.5">
                          <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2" onClick={() => onAddTask(m.id)}>
                            <Plus className="size-3.5" /> Add a task
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── Unphased work ──────────────────────────────────────────────── */}
      {unphased.length > 0 && (
        <section className="flex flex-col gap-3">
          <Head
            title="Not on the plan"
            count={unphased.length}
            note="Tasks on this project that are not filed under a phase"
          />
          <div className="rounded-xl border border-border bg-card shadow-e1">
            <ul className="divide-y divide-border/70">
              {unphased.map(t => (
                <li key={t.id} className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3">
                  <span className="min-w-0 truncate text-[13px] text-foreground">{t.title}</span>
                  <span className="flex shrink-0 items-center gap-4">
                    <TaskStatusTag status={t.status} />
                    <PersonChip person={t.assignee} size="xs" muted className="hidden md:inline-flex" />
                    <DueDate date={t.dueDate} done={t.status === 'done'} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <PhaseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        editing={editing}
        directory={directory}
        nextOrder={milestones.length}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Remove this phase"
        description={`"${deleting?.name}" leaves the roadmap. Tasks filed under it are kept and become unphased.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The plan against the calendar                                             */
/* -------------------------------------------------------------------------- */

/**
 * Every dated phase, positioned in the project's own window.
 *
 * ── Why this is not a Gantt chart ────────────────────────────────────────
 *
 * There are no dependencies drawn between bars, no critical path and nothing
 * draggable. A Gantt implies a scheduler behind it - move a bar and the ones
 * after it follow - and there is no such machinery here, so a draggable bar
 * would be a control that quietly does less than it looks like it does.
 *
 * What it is: the answer to "are these phases actually spread across the
 * project, or are four of them due in the same fortnight". That question is
 * unanswerable from a list of dates and obvious from thirty pixels of bar.
 *
 * Drawn only when at least two phases carry a date, because one bar on a
 * timeline is a line.
 */
function ScheduleStrip({
  milestones, project, today,
}: {
  milestones: Milestone[];
  project: Workspace['project'];
  today: string;
}) {
  const dated = milestones.filter(m => m.startDate || m.dueDate);
  if (dated.length < 2) return null;

  const stamps: string[] = [];
  for (const m of dated) {
    if (m.startDate) stamps.push(m.startDate);
    if (m.dueDate) stamps.push(m.dueDate);
  }
  if (project.startDate) stamps.push(project.startDate);
  if (project.endDate) stamps.push(project.endDate);

  const min = stamps.reduce((a, b) => (a < b ? a : b));
  const max = stamps.reduce((a, b) => (a > b ? a : b));
  const span = Math.max(1, daysUntil(max)! - daysUntil(min)!);
  const at = (iso: string) => ((daysUntil(iso)! - daysUntil(min)!) / span) * 100;

  const todayPos = today >= min && today <= max ? at(today) : null;

  return (
    <section className="flex flex-col gap-3">
      <Head title="Schedule" note={`${formatDay(min)} to ${formatDay(max)}`} />
      <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-e1">
        {/* Today, as a hairline behind the bars. */}
        {todayPos !== null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-4 w-px bg-foreground/25"
            style={{ left: `calc(1rem + (100% - 2rem) * ${todayPos / 100})` }}
          />
        )}

        <ul className="relative flex flex-col gap-2">
          {dated.map(m => {
            const start = m.startDate ?? m.dueDate!;
            const end = m.dueDate ?? m.startDate!;
            const left = at(start);
            const width = Math.max(1.5, at(end) - left);
            const late = !m.completedAt && m.dueDate && m.dueDate < today;

            return (
              <li key={m.id} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3">
                <span className={cn(
                  'truncate text-[12px]',
                  m.completedAt ? 'text-muted-foreground line-through' : 'text-foreground',
                )}>
                  {m.name}
                </span>
                <span className="relative h-3.5">
                  <span
                    title={`${STAGE_LABELS[m.stage] ?? m.stage} · ${formatDay(start)} to ${formatDay(end)}`}
                    className={cn(
                      'absolute inset-y-0 rounded-full',
                      late && 'ring-1 ring-destructive/60',
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: m.completedAt ? stageInk('completed') : stageInk(m.stage),
                      opacity: m.completedAt ? 0.55 : 1,
                    }}
                  />
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-3 flex justify-between border-t border-border/70 pt-2 text-[11px] tabular-nums text-muted-foreground">
          <span>{formatDay(min, { day: 'numeric', month: 'short' })}</span>
          {todayPos !== null && <span>today</span>}
          <span>{formatDay(max, { day: 'numeric', month: 'short' })}</span>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  The phase dialog                                                          */
/* -------------------------------------------------------------------------- */

function PhaseDialog({
  open, onOpenChange, projectId, editing, directory, nextOrder, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  editing: Milestone | null;
  directory: Member[];
  nextOrder: number;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    name: '', description: '', stage: 'planning',
    startDate: '', dueDate: '', ownerId: '_none', progressPct: 0,
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm(editing
      ? {
          name: editing.name,
          description: editing.description ?? '',
          stage: editing.stage,
          startDate: editing.startDate ?? '',
          dueDate: editing.dueDate ?? '',
          ownerId: editing.owner?.id ?? '_none',
          progressPct: editing.progressPct ?? 0,
        }
      : {
          name: '', description: '', stage: 'planning',
          startDate: '', dueDate: '', ownerId: '_none', progressPct: 0,
        });
  }, [open, editing]);

  const save = React.useCallback(async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        projectId,
        name: form.name.trim(),
        description: form.description,
        stage: form.stage,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        ownerId: form.ownerId === '_none' ? null : form.ownerId,
        progressPct: form.progressPct,
        ...(editing ? {} : { sortOrder: nextOrder }),
      };
      if (editing) {
        await patch(`/api/projects/milestones/${editing.id}`, payload);
        toast.success('Phase updated');
      } else {
        await post('/api/projects/milestones', payload);
        toast.success('Phase added');
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [form, editing, projectId, nextOrder, onOpenChange, onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Phase' : 'New phase'}</DialogTitle>
          <DialogDescription>
            A milestone on the roadmap. Completing it moves the project&apos;s
            reported progress and tells the team.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ms-name" className="text-[12.5px] font-medium">Name</Label>
            <Input
              id="ms-name" autoFocus
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Design sign-off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ms-desc" className="text-[12.5px] font-medium">What it covers</Label>
            <Textarea
              id="ms-desc" rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12.5px] font-medium">Stage</Label>
              <Select value={form.stage} onValueChange={v => setForm(f => ({ ...f, stage: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* `completed` is not offered: a phase is finished by ticking
                      it, which stamps the time on the server. */}
                  {ROADMAP_STAGES.filter(s => s !== 'completed').map(s => (
                    <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[12.5px] font-medium">Responsible</Label>
              <Select value={form.ownerId} onValueChange={v => setForm(f => ({ ...f, ownerId: v }))}>
                <SelectTrigger><SelectValue placeholder="Nobody yet" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Nobody yet</SelectItem>
                  {directory.map(d => (
                    <SelectItem key={d.memberId} value={d.memberId}>{d.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-start" className="text-[12.5px] font-medium">Starts</Label>
              <Input
                id="ms-start" type="date" value={form.startDate}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-due" className="text-[12.5px] font-medium">Due</Label>
              <Input
                id="ms-due" type="date" value={form.dueDate}
                onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
          </div>

          {/*
            How far along this phase is, as its owner sees it.

            The column, its CHECK constraint and its place in the progress
            blend have existed since 0016 and 0018, and nothing has ever set
            it - so a phase honestly reported at half done contributed exactly
            as much to the project's progress as one not started.
          */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ms-progress" className="text-[12.5px] font-medium">
              Reported progress
            </Label>
            <div className="flex items-center gap-3">
              <input
                id="ms-progress"
                type="range" min={0} max={100} step={5}
                value={form.progressPct}
                onChange={e => setForm(f => ({ ...f, progressPct: Number(e.target.value) }))}
                className="h-1.5 flex-1 accent-[var(--chart-1)]"
              />
              <span className="w-10 text-right text-[13px] tabular-nums text-foreground">
                {form.progressPct}%
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground">
              A phase in flight counts half of what it claims towards the
              project&apos;s progress. A completed one counts in full.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.name.trim()}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {editing ? 'Save' : 'Add phase'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
