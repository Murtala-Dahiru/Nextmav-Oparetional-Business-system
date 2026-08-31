'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft, LayoutDashboard, Milestone as MilestoneIcon, Users, CalendarDays,
  FileText, MessageSquare, Pencil, Plus, Building2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useProjectRealtime } from '@/hooks/use-realtime';
import { useAppStore } from '@/store/app-store';
import { formatDay } from '@/lib/format';

import { getOne, exact, pct, deadlineWord } from '../data';
import {
  HealthTag, StatusTag, PriorityTag, Progress, PersonChip, Figure, Nothing,
  healthReasons, HealthReasons,
} from '../ui';
import { ProjectDialog, TaskDialog } from '../forms';
import type { Member, Workspace as WorkspaceData } from '../types';

import { OverviewPanel } from './overview';
import { RoadmapPanel } from './roadmap';
import { TeamPanel } from './team';
import { TimelinePanel } from './timeline';
import { FilesPanel } from './files';
import { DiscussionPanel } from './discussion';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The project workspace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Six panels, in the order the questions get asked:
 *
 *   Overview    where is this, and what is in the way
 *   Roadmap     the plan, by phase, against the calendar
 *   Team        who is on it, in what capacity, carrying what
 *   Timeline    what has happened, and what is coming
 *   Files       deliverables, links, and what the client can see
 *   Discussion  the decisions, kept with the work rather than in chat
 *
 * ── One request, one consistent answer ───────────────────────────────────
 *
 * `/api/projects/projects/[id]/overview` returns all of it together. Fetching
 * the pieces separately means eight round trips before anything renders and,
 * worse, means the header and the roadmap can disagree about how many phases
 * are done. Every panel here reads the same object.
 *
 * ── The header is the verdict ────────────────────────────────────────────
 *
 * The workspace this replaces opened with a name, three pills and four
 * identical cards reading "Progress / Timeline / Team / Needs attention". Two
 * of those four printed the same glyphs for opposite meanings - `12d` under
 * "remaining" and `12d` under "past the end date" - and none of them said
 * *why* the project was graded the way it was. The header now leads with the
 * health verdict and the clauses behind it, because that is the sentence
 * somebody opens a project to read.
 */

type Panel = 'overview' | 'roadmap' | 'team' | 'timeline' | 'files' | 'discussion';

const PANELS: { id: Panel; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'roadmap', label: 'Roadmap', icon: MilestoneIcon },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'timeline', label: 'Timeline', icon: CalendarDays },
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'discussion', label: 'Discussion', icon: MessageSquare },
];

export function ProjectWorkspace({
  projectId, directory, onBack,
}: {
  projectId: string;
  directory: Member[];
  onBack: () => void;
}) {
  const [data, setData] = React.useState<WorkspaceData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [panel, setPanel] = React.useState<Panel>('overview');
  const [editOpen, setEditOpen] = React.useState(false);
  const [taskOpen, setTaskOpen] = React.useState(false);
  const [taskPhase, setTaskPhase] = React.useState<string | null>(null);

  const openRecord = useAppStore(s => s.openRecord);
  const allows = useAppStore(s => s.allows);
  const mayEdit = allows('projects', 'edit');

  /**
   * `silent` skips the spinner and the toast, for a realtime-triggered reload.
   *
   * An error on a background refresh is not something to interrupt anyone
   * with: the screen still holds the last good data, and a toast saying "could
   * not load the project" while the project is plainly on screen is worse than
   * saying nothing.
   */
  const load = React.useCallback(async (silent = false) => {
    try {
      setData(await getOne<WorkspaceData>(`/api/projects/projects/${projectId}/overview`));
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : 'Could not load the project');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => { load(); }, [load]);

  /**
   * The whole screen is derived data - progress, health, the roadmap, the task
   * counts, the risk list - so it is stale the moment anyone touches the
   * project. This is what "task completed, project progress updates
   * immediately" means in practice.
   */
  useProjectRealtime(projectId, () => load(true));

  const refresh = React.useCallback(() => { load(true); }, [load]);

  if (loading) return <WorkspaceSkeleton onBack={onBack} />;

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink onBack={onBack} />
        <Nothing
          title="This project is not available"
          note="It may have been deleted, or you may no longer have access to it."
        />
      </div>
    );
  }

  const { project, health, deliverables } = data;
  const grade = health?.health ?? 'on_track';

  /**
   * The next phase that is neither finished nor already late.
   *
   * Fed into the health reasons so an on-track project can say what it is
   * working towards rather than only how far along it is. Milestones arrive in
   * plan order, so the first match is the nearest.
   */
  const nextMilestone = data.milestones.find(m => !m.completedAt && m.dueDate) ?? null;

  const reasons = healthReasons({
    health: grade,
    status: project.status,
    endDate: project.endDate,
    daysRemaining: health?.daysRemaining ?? null,
    overdueTasks: health?.overdueTasks ?? 0,
    overdueMilestones: health?.overdueMilestones ?? 0,
    blockedTasks: health?.blockedTasks ?? 0,
    progressPct: health?.progressPct ?? 0,
    totalMilestones: health?.totalMilestones ?? 0,
    completedMilestones: health?.completedMilestones ?? 0,
    totalTasks: health?.totalTasks ?? 0,
    completedTasks: health?.completedTasks ?? 0,
    pendingDeliverables: deliverables.pending,
    rejectedDeliverables: deliverables.rejected,
    nextMilestone: nextMilestone ? { name: nextMilestone.name, dueDate: nextMilestone.dueDate } : null,
  });

  const attention = data.risks.length + data.blockers.length;

  return (
    <div className="nm-enter flex flex-col gap-5">
      <BackLink onBack={onBack} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h2 className="min-w-0 text-[22px] font-semibold leading-tight tracking-[-0.022em] text-foreground">
                {project.name}
              </h2>
              <StatusTag status={project.status} />
              <PriorityTag priority={project.priority} />
            </div>

            {project.description && (
              <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
                {project.description}
              </p>
            )}

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted-foreground">
              <PersonChip person={project.owner} size="xs" muted />
              <span className="text-muted-foreground/60">owner</span>

              {/*
                The customer, as a way through to them.

                A project belongs to a company in the CRM, and the two screens
                have been linked in the database since the first business
                migration with nothing in the interface connecting them. This
                is the same `openRecord` mechanism the command palette and the
                dashboard use, so the CRM opens on the right record rather than
                on its own home.
              */}
              {project.client && (
                <button
                  type="button"
                  onClick={() => openRecord('crm', 'company', project.client!.id)}
                  className="inline-flex items-center gap-1.5 underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  <Building2 className="size-3.5" />
                  {project.client.name}
                </button>
              )}
              {project.department && <span>{project.department.name}</span>}
              {project.budget > 0 && <span className="tabular-nums">{exact(project.budget)} budget</span>}
              {project.startDate && (
                <span>
                  {formatDay(project.startDate, { day: 'numeric', month: 'short' })}
                  {project.endDate && ` to ${formatDay(project.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}`}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {mayEdit && (
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setEditOpen(true)}>
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
            <Button
              size="sm" className="h-9 gap-1.5"
              onClick={() => { setTaskPhase(null); setTaskOpen(true); }}
            >
              <Plus className="size-4" /> New task
            </Button>
          </div>
        </div>

        {/*
          The verdict strip.

          One row, four regions, divided rather than boxed: four cards each
          carrying one number is the shape that made this header read as a
          dashboard bolted to a title. The first region is wider because it is
          the one carrying an argument rather than a figure.
        */}
        <div className={cn(
          'grid gap-x-6 gap-y-5 rounded-xl border bg-card p-4 shadow-e1 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] md:divide-x md:divide-border',
          grade === 'off_track' ? 'border-destructive/35' : 'border-border',
        )}>
          <div className="min-w-0 md:pr-6">
            <div className="flex items-baseline justify-between gap-3">
              <HealthTag health={grade} strong />
              <span className="text-[19px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-foreground">
                {pct(health?.progressPct ?? 0)}
              </span>
            </div>
            <Progress className="mt-2" value={health?.progressPct ?? 0} health={grade} height={5} />
            <HealthReasons reasons={reasons} className="mt-2.5" />
          </div>

          <div className="md:px-6">
            <Figure
              value={deadlineWord(health?.daysRemaining ?? null).split(' ')[0]}
              label={project.endDate ? deadlineWord(health?.daysRemaining ?? null).split(' ').slice(1).join(' ') : 'no end date'}
              tone={(health?.daysRemaining ?? 1) < 0 ? 'critical' : 'default'}
            />
          </div>

          <div className="md:px-6">
            <Figure
              value={data.members.length + (project.owner ? 1 : 0)}
              label="on the team"
              tone={data.members.length === 0 ? 'quiet' : 'default'}
            />
          </div>

          <button
            type="button"
            onClick={() => setPanel('overview')}
            className="rounded-md text-left transition-colors hover:bg-accent/60 md:px-6"
          >
            <Figure
              value={attention}
              label={attention === 1 ? 'thing to look at' : 'things to look at'}
              tone={data.blockers.length ? 'critical' : attention ? 'warning' : 'default'}
            />
          </button>
        </div>
      </header>

      {/* ── Panel navigation ───────────────────────────────────────────── */}
      <nav
        aria-label="Project panels"
        className={cn(
          'flex min-w-0 items-center gap-0.5 overflow-x-auto border-b border-border',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          // The fade is the only thing saying there is more. Six panels do not
          // fit on a phone, and a scroller that happens to end on a whole word
          // reads as the end of the list. Off where the row does not overflow.
          '[mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] lg:[mask-image:none]',
        )}
      >
        {PANELS.map(p => {
          const on = p.id === panel;
          const Icon = p.icon;
          const badge = p.id === 'files' && deliverables.pending > 0 ? deliverables.pending
            : p.id === 'discussion' && data.comments.length > 0 ? data.comments.length
              : null;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPanel(p.id)}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-2.5 text-[13px] font-medium transition-colors',
                on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className={cn('size-3.5', on ? 'opacity-100' : 'opacity-70')} />
              {p.label}
              {badge !== null && (
                <span className="rounded bg-muted px-1 py-px text-[10.5px] font-semibold tabular-nums text-muted-foreground">
                  {badge}
                </span>
              )}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-x-1.5 -bottom-px h-[2px] rounded-t-full transition-colors',
                  on ? 'bg-foreground' : 'bg-transparent',
                )}
              />
            </button>
          );
        })}
      </nav>

      {/* ── The panel ──────────────────────────────────────────────────── */}
      {panel === 'overview' && (
        <OverviewPanel
          data={data}
          onGoPanel={setPanel}
          onNewTask={() => { setTaskPhase(null); setTaskOpen(true); }}
        />
      )}
      {panel === 'roadmap' && (
        <RoadmapPanel
          projectId={projectId}
          data={data}
          directory={directory}
          onChanged={refresh}
          onAddTask={milestoneId => { setTaskPhase(milestoneId); setTaskOpen(true); }}
        />
      )}
      {panel === 'team' && (
        <TeamPanel projectId={projectId} data={data} directory={directory} onChanged={refresh} />
      )}
      {panel === 'timeline' && <TimelinePanel data={data} />}
      {panel === 'files' && (
        <FilesPanel projectId={projectId} data={data} onChanged={refresh} />
      )}
      {panel === 'discussion' && (
        <DiscussionPanel projectId={projectId} data={data} directory={directory} onChanged={refresh} />
      )}

      <ProjectDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={{
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          priority: project.priority,
          budget: project.budget,
          startDate: project.startDate,
          endDate: project.endDate,
          clientCompanyId: project.clientCompanyId,
          owner: project.owner ?? null,
          client: project.client ?? null,
          department: project.department ?? null,
        }}
        directory={directory}
        onSaved={refresh}
      />

      <TaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        editing={null}
        directory={directory}
        projects={[{ id: project.id, name: project.name }]}
        defaultProjectId={project.id}
        defaultMilestoneId={taskPhase}
        onSaved={refresh}
      />
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="-ml-1 inline-flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" /> All projects
    </button>
  );
}

/** Shaped like the header it precedes, so nothing jumps when the data lands. */
function WorkspaceSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <BackLink onBack={onBack} />
      <div className="flex flex-col gap-3">
        <div className="h-6 w-64 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-lg animate-pulse rounded bg-muted" />
        <div className="h-3 w-80 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-[7.5rem] animate-pulse rounded-xl bg-muted" />
      <div className="h-9 w-full animate-pulse rounded bg-muted" />
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}

