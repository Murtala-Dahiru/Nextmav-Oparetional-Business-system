'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Clock, Users, FileText, MessageSquare,
  CalendarDays, Milestone as MilestoneIcon, LayoutDashboard, Plus, Loader2,
  Trash2, Download, Eye, EyeOff, Send, UserPlus, Ban, Pencil,
} from 'lucide-react';

import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatCurrency, formatDate, formatFileSize, initialsOf } from '@/lib/format';
import { ROADMAP_STAGES, PROJECT_ROLES, statusLabel } from '@/lib/constants';
import { useProjectRealtime } from '@/hooks/use-realtime';
import { cn } from '@/lib/utils';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Project execution workspace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The Projects module already had a board of cards and a task table. What it
 * had no way to show was a *project* — the thing a card stands for.
 *
 * `milestones` and `project_members` have had tables, RLS policies and, since
 * the previous phase, working endpoints. Nothing rendered either of them, so a
 * project could not be divided into phases, could hold only its owner, had
 * nowhere for its files and no thread to discuss it in. Everything here reads
 * data the schema has always been able to hold.
 *
 * Six panels, in the order the questions get asked:
 *
 *   Overview   where is this, and what is in the way
 *   Roadmap    the plan, by phase
 *   Team       who is on it and in what capacity
 *   Timeline   what happened and what is coming
 *   Files      deliverables, and which of them the client can see
 *   Discussion the decisions, kept with the work rather than in chat
 *
 * The risks and blockers on the Overview are derived by the endpoint from the
 * work itself, never entered by hand — a risk register somebody maintains
 * manually goes stale in a fortnight and then actively misleads.
 */

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface DirectoryMember {
  memberId: string;
  fullName: string;
  jobTitle: string | null;
  departmentName: string | null;
}

interface Person { id: string; profiles?: { fullName: string; avatarUrl: string | null; jobTitle?: string | null } }

interface Milestone {
  id: string;
  name: string;
  description: string;
  stage: string;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  progressPct: number;
  sortOrder: number;
  owner?: Person | null;
}

interface ProjectMember {
  id: string;
  role: string;
  allocationPct: number;
  joinedAt: string;
  member?: Person & { role?: string; departmentId?: string | null };
}

interface WorkspaceTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  milestoneId: string | null;
  assignee?: Person | null;
}

interface ProjectFile {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  folder: string;
  isClientVisible: boolean;
  createdAt: string;
}

interface Comment {
  id: string;
  body: string;
  mentions: string[];
  isClientVisible: boolean;
  createdAt: string;
  editedAt: string | null;
  author?: Person;
}

interface Risk { kind: string; id: string; title: string; owner: string | null; detail: string }

interface TimelineEntry { at: string; kind: string; title: string; detail: string; id?: string }

interface Health {
  progressPct: number;
  health: string;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  totalMilestones: number;
  completedMilestones: number;
  overdueMilestones: number;
  daysRemaining: number | null;
  loggedHours: number;
  memberCount: number;
}

interface Overview {
  project: {
    id: string;
    name: string;
    description: string;
    status: string;
    priority: string;
    startDate: string | null;
    endDate: string | null;
    budget: number;
    owner?: Person | null;
    department?: { id: string; name: string } | null;
    client?: { id: string; name: string } | null;
  };
  health: Health | null;
  members: ProjectMember[];
  milestones: Milestone[];
  tasks: WorkspaceTask[];
  files: ProjectFile[];
  comments: Comment[];
  timeline: TimelineEntry[];
  risks: Risk[];
  blockers: Risk[];
}

const STAGE_LABELS: Record<string, string> = {
  planning: 'Planning',
  development: 'Development',
  testing: 'Testing',
  review: 'Review',
  deployment: 'Deployment',
  completed: 'Completed',
};

const HEALTH_STYLES: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  on_track:  { label: 'On track',  className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: CheckCircle2 },
  at_risk:   { label: 'At risk',   className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',        icon: Clock },
  off_track: { label: 'Off track', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',                icon: AlertTriangle },
};

async function api<T>(url: string, init?: RequestInit): Promise<{ data: T }> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json().catch(() => null);
  if (json?.error) throw new Error(json.error.message || 'Request failed');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return json;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Workspace
// ═══════════════════════════════════════════════════════════════════════════

export function ProjectWorkspace({
  projectId, directory, onBack,
}: {
  projectId: string;
  directory: DirectoryMember[];
  onBack: () => void;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * `silent` skips the toast and the spinner, for a realtime-triggered reload.
   *
   * An error on a background refresh is not something to interrupt anyone
   * with — the screen still holds the last good data, and a toast saying
   * "could not load the project" while the project is plainly on screen is
   * worse than saying nothing.
   */
  const load = useCallback(async (silent = false) => {
    try {
      const res = await api<Overview>(`/api/projects/projects/${projectId}/overview`);
      setData(res.data);
    } catch (e: any) {
      if (!silent) toast.error(e.message || 'Could not load the project');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  /**
   * The overview is entirely derived data — progress, health, the roadmap, the
   * task counts, the risk list — so it is stale the moment anyone touches the
   * project. This is the screen the specification means by "task completed,
   * project progress updates immediately".
   */
  useProjectRealtime(projectId, () => load(true));

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-72 rounded-lg" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 w-fit gap-1.5">
          <ArrowLeft className="size-4" /> All projects
        </Button>
        <EmptyState
          icon={AlertTriangle}
          title="Project not available"
          description="It may have been deleted, or you may not have access to it."
        />
      </div>
    );
  }

  const { project, health } = data;
  const verdict = HEALTH_STYLES[health?.health ?? 'on_track'] ?? HEALTH_STYLES.on_track;
  const VerdictIcon = verdict.icon;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-2 gap-1.5">
          <ArrowLeft className="size-4" /> All projects
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
              <Badge variant="secondary">{statusLabel(project.status)}</Badge>
              <Badge variant="secondary" className={cn('gap-1', verdict.className)}>
                <VerdictIcon className="size-3" /> {verdict.label}
              </Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {project.description || 'No description.'}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {project.owner && (
                <span className="flex items-center gap-1.5">
                  <Avatar className="size-4">
                    <AvatarFallback className="bg-emerald-100 text-[8px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      {initialsOf(project.owner.profiles?.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  {project.owner.profiles?.fullName ?? 'Unassigned'} · owner
                </span>
              )}
              {project.client && <span>Client: {project.client.name}</span>}
              {project.department && <span>{project.department.name}</span>}
              {project.budget > 0 && <span>{formatCurrency(project.budget)}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── The four numbers ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Progress</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {health?.progressPct ?? 0}%
            </p>
            <Progress value={health?.progressPct ?? 0} className="mt-2 h-1.5" />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {/* Says which basis, because the view prefers phases over tasks
                  when a project has them and the two numbers differ. */}
              {(health?.totalMilestones ?? 0) > 0
                ? `${health?.completedMilestones ?? 0} of ${health?.totalMilestones} phases`
                : `${health?.completedTasks ?? 0} of ${health?.totalTasks ?? 0} tasks`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Timeline</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {health?.daysRemaining == null
                ? '—'
                : health.daysRemaining < 0
                  ? `${Math.abs(health.daysRemaining)}d`
                  : `${health.daysRemaining}d`}
            </p>
            <p className={cn(
              'mt-1 text-[11px]',
              (health?.daysRemaining ?? 0) < 0 ? 'text-destructive' : 'text-muted-foreground',
            )}>
              {health?.daysRemaining == null ? 'No end date'
                : health.daysRemaining < 0 ? 'past the end date' : 'remaining'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Team</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {data.members.length}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {data.members.length === 0 ? 'nobody assigned yet' : 'people on this project'}
            </p>
          </CardContent>
        </Card>

        <Card className={cn((data.blockers.length > 0) && 'border-destructive/40')}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Needs attention</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {data.risks.length + data.blockers.length}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {data.blockers.length} blocked · {data.risks.length} at risk
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview" className="gap-1.5">
            <LayoutDashboard className="size-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="roadmap" className="gap-1.5">
            <MilestoneIcon className="size-4" /> Roadmap
          </TabsTrigger>
          <TabsTrigger value="team" className="gap-1.5">
            <Users className="size-4" /> Team
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5">
            <CalendarDays className="size-4" /> Timeline
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-1.5">
            <FileText className="size-4" /> Files
          </TabsTrigger>
          <TabsTrigger value="discussion" className="gap-1.5">
            <MessageSquare className="size-4" /> Discussion
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewPanel data={data} today={today} />
        </TabsContent>

        <TabsContent value="roadmap" className="mt-4">
          <RoadmapPanel
            projectId={projectId}
            milestones={data.milestones}
            tasks={data.tasks}
            directory={directory}
            today={today}
            onChanged={load}
          />
        </TabsContent>

        <TabsContent value="team" className="mt-4">
          <TeamPanel
            projectId={projectId}
            members={data.members}
            owner={data.project.owner ?? null}
            directory={directory}
            onChanged={load}
          />
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <TimelinePanel timeline={data.timeline} today={today} />
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <FilesPanel files={data.files} onChanged={load} />
        </TabsContent>

        <TabsContent value="discussion" className="mt-4">
          <DiscussionPanel
            projectId={projectId}
            comments={data.comments}
            directory={directory}
            onChanged={load}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Overview
// ═══════════════════════════════════════════════════════════════════════════

function OverviewPanel({ data, today }: { data: Overview; today: string }) {
  const { project, health, risks, blockers, milestones, tasks } = data;

  const upcoming = useMemo(
    () => milestones
      .filter(m => !m.completedAt && m.dueDate && m.dueDate >= today)
      .slice(0, 4),
    [milestones, today],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Blockers first: work nobody can proceed on is the most urgent thing
          on any project and it was previously invisible outside the task list. */}
      <Card className={cn(blockers.length > 0 && 'border-destructive/40')}>
        <CardContent className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Ban className="size-4 text-destructive" /> Blockers
          </h3>
          {blockers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is blocked.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {blockers.map(b => (
                <div key={b.id} className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
                  <p className="text-sm font-medium text-foreground">{b.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.detail}{b.owner && ` · ${b.owner}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="size-4 text-amber-500" /> Risks
          </h3>
          {risks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing overdue or unassigned.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {risks.map((r, i) => (
                <div key={`${r.kind}-${r.id}-${i}`} className="rounded-md border p-2.5">
                  <p className="text-sm font-medium text-foreground">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.detail}{r.owner && ` · ${r.owner}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Coming up</h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scheduled phases ahead.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {upcoming.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {STAGE_LABELS[m.stage] ?? m.stage}
                      {m.owner?.profiles?.fullName && ` · ${m.owner.profiles.fullName}`}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {m.dueDate && formatDate(m.dueDate, { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Work</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Tasks</dt>
            <dd className="text-right tabular-nums text-foreground">
              {health?.completedTasks ?? 0} / {health?.totalTasks ?? 0}
            </dd>
            <dt className="text-muted-foreground">Overdue</dt>
            <dd className={cn(
              'text-right tabular-nums',
              (health?.overdueTasks ?? 0) > 0 ? 'text-destructive' : 'text-foreground',
            )}>
              {health?.overdueTasks ?? 0}
            </dd>
            <dt className="text-muted-foreground">Hours logged</dt>
            <dd className="text-right tabular-nums text-foreground">{health?.loggedHours ?? 0}</dd>
            <dt className="text-muted-foreground">Starts</dt>
            <dd className="text-right text-foreground">
              {project.startDate ? formatDate(project.startDate) : '—'}
            </dd>
            <dt className="text-muted-foreground">Target</dt>
            <dd className="text-right text-foreground">
              {project.endDate ? formatDate(project.endDate) : '—'}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Roadmap
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The plan, grouped by delivery phase.
 *
 * Every phase column is rendered even when empty, because the empty ones are
 * information: a project with nothing under "Testing" has not planned any.
 * Hiding them would make the gap invisible, which is the opposite of what a
 * roadmap is for.
 */
function RoadmapPanel({
  projectId, milestones, tasks, directory, today, onChanged,
}: {
  projectId: string;
  milestones: Milestone[];
  tasks: WorkspaceTask[];
  directory: DirectoryMember[];
  today: string;
  onChanged: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Milestone | null>(null);

  const [form, setForm] = useState({
    name: '', description: '', stage: 'planning',
    startDate: '', dueDate: '', ownerId: '_none',
  });

  const taskCountFor = useCallback(
    (milestoneId: string) => tasks.filter(t => t.milestoneId === milestoneId).length,
    [tasks],
  );

  const openCreate = useCallback((stage: string) => {
    setEditing(null);
    setForm({ name: '', description: '', stage, startDate: '', dueDate: '', ownerId: '_none' });
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((m: Milestone) => {
    setEditing(m);
    setForm({
      name: m.name,
      description: m.description ?? '',
      stage: m.stage,
      startDate: m.startDate ?? '',
      dueDate: m.dueDate ?? '',
      ownerId: m.owner?.id ?? '_none',
    });
    setDialogOpen(true);
  }, []);

  const save = useCallback(async () => {
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
      };
      if (editing) {
        await api(`/api/projects/milestones/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/api/projects/milestones', { method: 'POST', body: JSON.stringify(payload) });
      }
      toast.success(editing ? 'Phase updated' : 'Phase added');
      setDialogOpen(false);
      onChanged();
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [form, editing, projectId, onChanged]);

  /**
   * Completing a phase.
   *
   * Sends `completed: true` and lets the server stamp the time — a client
   * choosing the moment would let a roadmap be backdated, and the completion
   * notification to the team reads that timestamp.
   */
  const toggleComplete = useCallback(async (m: Milestone) => {
    try {
      await api(`/api/projects/milestones/${m.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !m.completedAt }),
      });
      onChanged();
    } catch (e: any) {
      toast.error(e.message || 'Could not update the phase');
    }
  }, [onChanged]);

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    try {
      await api(`/api/projects/milestones/${deleting.id}`, { method: 'DELETE' });
      toast.success('Phase removed. Its tasks were kept.');
      setDeleting(null);
      onChanged();
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    }
  }, [deleting, onChanged]);

  return (
    <div className="flex flex-col gap-4">
      {milestones.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <MilestoneIcon className="size-6 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">No roadmap yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Break the project into phases so progress is measured against the
              plan rather than a task count. Progress switches to counting
              phases as soon as you add one.
            </p>
            <Button size="sm" onClick={() => openCreate('planning')} className="mt-1 gap-1.5">
              <Plus className="size-4" /> Add the first phase
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ROADMAP_STAGES.map(stage => {
          const inStage = milestones.filter(m => m.stage === stage);
          const done = inStage.filter(m => m.completedAt).length;

          return (
            <div key={stage} className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-0.5">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {STAGE_LABELS[stage]}
                  {inStage.length > 0 && (
                    <span className="tabular-nums text-muted-foreground/70">
                      {done}/{inStage.length}
                    </span>
                  )}
                </h3>
                <button
                  type="button"
                  aria-label={`Add a phase to ${STAGE_LABELS[stage]}`}
                  onClick={() => openCreate(stage)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>

              <div className="flex min-h-[3rem] flex-col gap-2 rounded-lg border border-dashed p-2">
                {inStage.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground/60">Nothing planned</p>
                ) : inStage.map(m => {
                  const overdue = !m.completedAt && m.dueDate && m.dueDate < today;
                  return (
                    <Card key={m.id} className={cn('group', overdue && 'border-destructive/40')}>
                      <CardContent className="p-3">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            checked={!!m.completedAt}
                            onCheckedChange={() => toggleComplete(m)}
                            className="mt-0.5 shrink-0"
                            aria-label={m.completedAt ? 'Reopen this phase' : 'Mark this phase complete'}
                          />
                          <div className="min-w-0 flex-1">
                            <p className={cn(
                              'text-sm font-medium leading-snug',
                              m.completedAt ? 'text-muted-foreground line-through' : 'text-foreground',
                            )}>
                              {m.name}
                            </p>
                            {m.description && (
                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                {m.description}
                              </p>
                            )}

                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                              {m.dueDate && (
                                <span className={overdue ? 'text-destructive' : 'text-muted-foreground'}>
                                  {overdue ? 'Overdue ' : 'Due '}
                                  {formatDate(m.dueDate, { month: 'short', day: 'numeric' })}
                                </span>
                              )}
                              {taskCountFor(m.id) > 0 && (
                                <span className="text-muted-foreground">
                                  {taskCountFor(m.id)} task{taskCountFor(m.id) === 1 ? '' : 's'}
                                </span>
                              )}
                              {m.owner?.profiles?.fullName && (
                                <span className="flex items-center gap-1 text-muted-foreground">
                                  <Avatar className="size-3.5">
                                    <AvatarFallback className="bg-emerald-100 text-[7px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                      {initialsOf(m.owner.profiles.fullName)}
                                    </AvatarFallback>
                                  </Avatar>
                                  {m.owner.profiles.fullName}
                                </span>
                              )}
                            </div>
                          </div>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-6 shrink-0 opacity-0 transition group-hover:opacity-100">
                                <Pencil className="size-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(m)}>
                                <Pencil className="mr-2 size-4" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleting(m)}
                              >
                                <Trash2 className="mr-2 size-4" /> Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Phase dialog ────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit phase' : 'New phase'}</DialogTitle>
            <DialogDescription>
              A milestone within the roadmap. Completing it moves the project's
              reported progress and notifies the team.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="ms-name">Name *</Label>
              <Input
                id="ms-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Design sign-off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ms-desc">Description</Label>
              <Textarea
                id="ms-desc"
                rows={2}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Phase</Label>
                <Select value={form.stage} onValueChange={v => setForm(f => ({ ...f, stage: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROADMAP_STAGES.filter(s => s !== 'completed').map(s => (
                      <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Responsible</Label>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ms-start">Starts</Label>
                <Input
                  id="ms-start" type="date" value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ms-due">Due</Label>
                <Input
                  id="ms-due" type="date" value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={save}
              disabled={saving || !form.name.trim()}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {editing ? 'Save' : 'Add phase'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Remove this phase"
        description={`"${deleting?.name}" will be removed from the roadmap. Tasks filed under it are kept and become unphased.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Team
// ═══════════════════════════════════════════════════════════════════════════

function TeamPanel({
  projectId, members, owner, directory, onChanged,
}: {
  projectId: string;
  members: ProjectMember[];
  owner: Person | null;
  directory: DirectoryMember[];
  onChanged: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [role, setRole] = useState<string>('contributor');
  const [allocation, setAllocation] = useState(100);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<ProjectMember | null>(null);

  // Somebody already on the project should not be offered again — the unique
  // constraint would reject it, and an option that always errors is a bug.
  const available = useMemo(() => {
    const taken = new Set(members.map(m => m.member?.id));
    return directory.filter(d => !taken.has(d.memberId));
  }, [directory, members]);

  const add = useCallback(async () => {
    if (!memberId) return;
    setSaving(true);
    try {
      await api('/api/projects/members', {
        method: 'POST',
        body: JSON.stringify({ projectId, memberId, role, allocationPct: allocation }),
      });
      toast.success('Added to the project');
      setAddOpen(false);
      setMemberId('');
      onChanged();
    } catch (e: any) {
      toast.error(e.message || 'Could not add them');
    } finally {
      setSaving(false);
    }
  }, [memberId, role, allocation, projectId, onChanged]);

  const remove = useCallback(async () => {
    if (!removing) return;
    try {
      await api(`/api/projects/members/${removing.id}`, { method: 'DELETE' });
      toast.success('Removed from the project');
      setRemoving(null);
      onChanged();
    } catch (e: any) {
      toast.error(e.message || 'Could not remove them');
    }
  }, [removing, onChanged]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Everyone working on this project, and how much of their time it has.
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
          <UserPlus className="size-4" /> Add someone
        </Button>
      </div>

      {/* The owner is shown separately: they are on `projects.owner_id`, not
          in `project_members`, and cannot be removed from here. */}
      {owner && (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Avatar className="size-9">
              <AvatarFallback className="bg-emerald-100 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                {initialsOf(owner.profiles?.fullName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {owner.profiles?.fullName ?? 'Unassigned'}
              </p>
              <p className="text-xs text-muted-foreground">
                {owner.profiles?.jobTitle || 'Project owner'}
              </p>
            </div>
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              Owner
            </Badge>
          </CardContent>
        </Card>
      )}

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No one else on this project"
          description="Add colleagues so work can be assigned and they are told about changes."
          action={{ label: 'Add someone', onClick: () => setAddOpen(true) }}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {members.map(pm => (
                <div key={pm.id} className="group flex items-center gap-3 p-4">
                  <Avatar className="size-9">
                    <AvatarFallback className="bg-muted text-xs">
                      {initialsOf(pm.member?.profiles?.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {pm.member?.profiles?.fullName ?? 'Unknown'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {pm.member?.profiles?.jobTitle || statusLabel(pm.role)}
                      {' · joined '}{formatDate(pm.joinedAt, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-normal">{statusLabel(pm.role)}</Badge>
                    <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                      {pm.allocationPct}%
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 opacity-0 transition group-hover:opacity-100"
                      onClick={() => setRemoving(pm)}
                      aria-label="Remove from project"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add someone to this project</DialogTitle>
            <DialogDescription>
              They will be notified, and will start receiving updates about
              status changes, phases and discussion.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label>Person</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger><SelectValue placeholder="Choose a colleague" /></SelectTrigger>
                <SelectContent>
                  {available.map(d => (
                    <SelectItem key={d.memberId} value={d.memberId}>
                      {d.fullName}
                      {d.jobTitle && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{d.jobTitle}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {available.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Everyone in the directory is already on this project.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role on the project</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_ROLES.map(r => (
                      <SelectItem key={r} value={r}>{statusLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="alloc">Allocation %</Label>
                <Input
                  id="alloc" type="number" min={0} max={100}
                  value={allocation}
                  onChange={e => setAllocation(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={add}
              disabled={saving || !memberId}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={o => { if (!o) setRemoving(null); }}
        title="Remove from project"
        description={`${removing?.member?.profiles?.fullName ?? 'This person'} will no longer receive updates about this project. Work already assigned to them is not reassigned.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={remove}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Timeline
// ═══════════════════════════════════════════════════════════════════════════

function TimelinePanel({ timeline, today }: { timeline: TimelineEntry[]; today: string }) {
  if (timeline.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing dated yet"
        description="Start and end dates, phases and meetings all appear here in one sequence."
      />
    );
  }

  return (
    <div className="relative flex flex-col pl-6">
      <div className="absolute bottom-2 left-[7px] top-2 w-px bg-border" />
      {timeline.map((t, i) => {
        const future = t.at > today;
        return (
          <div key={`${t.kind}-${t.id ?? i}`} className="relative flex gap-3 pb-5">
            <span className={cn(
              'absolute -left-6 top-1.5 size-[9px] rounded-full ring-4 ring-background',
              t.kind === 'milestone_completed' ? 'bg-emerald-500'
                : t.kind === 'meeting' ? 'bg-blue-500'
                : t.kind === 'milestone_due' && !future ? 'bg-destructive'
                : 'bg-muted-foreground/40',
            )} />
            <div className="min-w-0 flex-1">
              <p className={cn(
                'text-sm font-medium',
                future ? 'text-muted-foreground' : 'text-foreground',
              )}>
                {t.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.detail} · {formatDate(t.at)}
                {future && ' · upcoming'}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Files
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Project files, grouped by folder.
 *
 * The visibility toggle is the important control here: it is what publishes a
 * file to the client portal. Rendered as an explicit, labelled action rather
 * than an icon, because accidentally sharing an internal document with a
 * customer is not a mistake that should be one ambiguous click away.
 */
function FilesPanel({ files, onChanged }: { files: ProjectFile[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProjectFile | null>(null);

  const byFolder = useMemo(() => {
    const groups = new Map<string, ProjectFile[]>();
    for (const f of files) {
      const key = f.folder || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(f);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [files]);

  const toggleVisibility = useCallback(async (f: ProjectFile) => {
    setBusy(f.id);
    try {
      await api(`/api/projects/files/${f.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isClientVisible: !f.isClientVisible }),
      });
      toast.success(f.isClientVisible ? 'Withdrawn from the client portal' : 'Shared with the client');
      onChanged();
    } catch (e: any) {
      toast.error(e.message || 'Could not change visibility');
    } finally {
      setBusy(null);
    }
  }, [onChanged]);

  const open = useCallback(async (f: ProjectFile) => {
    try {
      const res = await api<{ url: string }>(`/api/projects/files/${f.id}`);
      if (res.data?.url) window.open(res.data.url, '_blank', 'noopener');
    } catch (e: any) {
      toast.error(e.message || 'Could not open that file');
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    try {
      await api(`/api/projects/files/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      onChanged();
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    }
  }, [deleting, onChanged]);

  if (files.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No files yet"
        description="Files attached to this project appear here, and can be published to the client portal individually."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {byFolder.map(([folder, group]) => (
        <div key={folder || '_root'}>
          {folder && (
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {folder}
            </h3>
          )}
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {group.map(f => (
                  <div key={f.id} className="group flex items-center gap-3 p-4">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{f.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(f.sizeBytes)} · {formatDate(f.createdAt)}
                      </p>
                    </div>

                    {f.isClientVisible && (
                      <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        <Eye className="size-3" /> Client can see
                      </Badge>
                    )}

                    <Button variant="ghost" size="sm" onClick={() => open(f)} className="gap-1.5">
                      <Download className="size-3.5" /> Open
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 opacity-0 transition group-hover:opacity-100">
                          {busy === f.id
                            ? <Loader2 className="size-4 animate-spin" />
                            : <Pencil className="size-3.5" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => toggleVisibility(f)}>
                          {f.isClientVisible
                            ? <><EyeOff className="mr-2 size-4" /> Withdraw from client</>
                            : <><Eye className="mr-2 size-4" /> Share with client</>}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleting(f)}
                        >
                          <Trash2 className="mr-2 size-4" /> Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ))}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title="Remove this file"
        description={`"${deleting?.filename}" will be removed from the project and withdrawn from the client portal. The stored file itself is kept.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Discussion
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The project's thread.
 *
 * Two things make this more than a comment box. Mentions notify the person
 * named, and the client-visible switch decides whether a message is an
 * internal note or something the customer reads in their portal — one
 * chronology for both, because the team keeping two histories of the same
 * project is how context gets lost.
 */
function DiscussionPanel({
  projectId, comments, directory, onChanged,
}: {
  projectId: string;
  comments: Comment[];
  directory: DirectoryMember[];
  onChanged: () => void;
}) {
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [clientVisible, setClientVisible] = useState(false);
  const [sending, setSending] = useState(false);

  // Newest last, so a thread reads top to bottom like a conversation. The
  // endpoint returns newest first for the overview's preview.
  const ordered = useMemo(
    () => [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [comments],
  );

  const post = useCallback(async () => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      await api('/api/projects/comments', {
        method: 'POST',
        body: JSON.stringify({ projectId, body: text, mentions, isClientVisible: clientVisible }),
      });
      setBody('');
      setMentions([]);
      setClientVisible(false);
      onChanged();
    } catch (e: any) {
      toast.error(e.message || 'Could not post that');
    } finally {
      setSending(false);
    }
  }, [body, mentions, clientVisible, projectId, onChanged]);

  return (
    <div className="flex flex-col gap-4">
      {ordered.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No discussion yet"
          description="Decisions kept here stay with the project, rather than scrolling away in chat."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {ordered.map(c => (
            <Card key={c.id} className={cn(c.isClientVisible && 'border-blue-500/30')}>
              <CardContent className="flex items-start gap-3 p-4">
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-muted text-[10px]">
                    {initialsOf(c.author?.profiles?.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {c.author?.profiles?.fullName ?? 'Unknown'}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatDate(c.createdAt)}
                    </span>
                    {c.editedAt && (
                      <span className="text-[11px] text-muted-foreground/70">edited</span>
                    )}
                    {c.isClientVisible && (
                      <Badge variant="secondary" className="gap-1 bg-blue-100 px-1.5 py-0 text-[10px] text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        <Eye className="size-2.5" /> Client
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{c.body}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <Textarea
            rows={3}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Add to the discussion…"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value=""
                onValueChange={v => setMentions(m => (m.includes(v) ? m : [...m, v]))}
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder={mentions.length ? `${mentions.length} mentioned` : 'Notify someone'} />
                </SelectTrigger>
                <SelectContent>
                  {directory.map(d => (
                    <SelectItem key={d.memberId} value={d.memberId}>{d.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {mentions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {mentions.map(id => {
                    const person = directory.find(d => d.memberId === id);
                    return (
                      <Badge
                        key={id}
                        variant="outline"
                        className="cursor-pointer gap-1 font-normal"
                        onClick={() => setMentions(m => m.filter(x => x !== id))}
                      >
                        {person?.fullName ?? 'Someone'} ×
                      </Badge>
                    );
                  })}
                </div>
              )}

              {/*
                Internal by default, and the label says what it means in plain
                words rather than "visibility". Somebody skim-reading must not
                be able to mistake this for a formatting option.
              */}
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={clientVisible}
                  onCheckedChange={v => setClientVisible(v === true)}
                />
                Show this to the client
              </label>
            </div>

            <Button
              size="sm"
              disabled={sending || !body.trim()}
              onClick={post}
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Post
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
