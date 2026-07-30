'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Building2, FolderKanban, FileText, Receipt, LifeBuoy, Megaphone,
  CheckCircle2, Clock, AlertTriangle, Download, Send, Loader2,
  CalendarDays, MessageSquare, ArrowLeft, Milestone as MilestoneIcon,
} from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/empty-state';
import { formatCurrency, formatDate, formatFileSize, initialsOf } from '@/lib/format';
import { statusLabel, ROADMAP_STAGES } from '@/lib/constants';
import { useAppStore } from '@/store/app-store';
import { useProjectRealtime, useModuleRealtime } from '@/hooks/use-realtime';
import { cn } from '@/lib/utils';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Client portal
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * What a customer sees of their own engagement.
 *
 * ── The design constraint ─────────────────────────────────────────────────
 *
 * A client is not a limited employee, so this is not the Projects module with
 * buttons removed. It answers the four questions a customer actually has —
 * where is my project, what have you delivered, what do I owe, who do I talk
 * to — and it answers them without exposing task boards, budgets, internal
 * discussion or anyone's workload.
 *
 * The one thing it deliberately does *not* soften is bad news. A project past
 * its end date says so, and an overdue phase is marked overdue. Hiding that
 * makes the portal a brochure the client learns to distrust, and they find out
 * from the deadline anyway.
 *
 * Staff reach the same screen with a company picker, so anyone can check what
 * a customer is being shown without logging in as them.
 */

// ═══════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════

interface PortalProject {
  projectId: string;
  name: string;
  description: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  progressPct: number | null;
  health: string | null;
  totalMilestones: number | null;
  completedMilestones: number | null;
  overdueMilestones: number | null;
  daysRemaining: number | null;
  deliverableCount: number | null;
  messageCount: number | null;
  ownerName: string | null;
}

interface PortalInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  currency: string;
}

interface PortalTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  isPinned: boolean;
  publishedAt: string;
}

interface Milestone {
  id: string;
  name: string;
  description: string;
  stage: string;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  progressPct: number;
}

interface Deliverable {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  folder: string;
  createdAt: string;
  /**
   * Whether this file is being put forward for acceptance, and what the client
   * decided.
   *
   * A shared file and a deliverable awaiting sign-off used to look identical
   * here, which meant a project could wait a fortnight on a decision the client
   * did not know was theirs to make. `approvalDecision` is null until somebody
   * decides; `'rejected'` carries a note explaining what needs changing.
   */
  requiresApproval: boolean;
  approvalDecision: 'approved' | 'rejected' | null;
  approvedAt: string | null;
  approvalNote: string;
  approver?: { id: string; profiles?: { fullName: string } } | null;
}

interface PortalMessage {
  id: string;
  body: string;
  createdAt: string;
  author?: { id: string; profiles?: { fullName: string; avatarUrl: string | null } };
}

interface TimelineEntry {
  at: string;
  kind: string;
  title: string;
  detail: string;
  id?: string;
}

interface Company { id: string; name: string; industry: string | null }

interface PortalData {
  company: Company;
  projects: PortalProject[];
  invoices: PortalInvoice[];
  tickets: PortalTicket[];
  announcements: Announcement[];
  summary: {
    activeProjects: number;
    totalProjects: number;
    projectsOffTrack: number;
    projectsAtRisk: number;
    openTickets: number;
    outstandingBalance: number;
    currency: string;
  };
}

interface ProjectDetail {
  project: PortalProject;
  milestones: Milestone[];
  deliverables: Deliverable[];
  messages: PortalMessage[];
  meetings: { id: string; title: string; startsAt: string; location: string | null }[];
  timeline: TimelineEntry[];
  approvals: { total: number; pending: number; approved: number; rejected: number };
  canDecideDeliverables: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Presentation
// ═══════════════════════════════════════════════════════════════════════════

const HEALTH: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  on_track:  { label: 'On track',  className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', icon: CheckCircle2 },
  at_risk:   { label: 'At risk',   className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',        icon: Clock },
  off_track: { label: 'Off track', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',                icon: AlertTriangle },
};

const STAGE_LABELS: Record<string, string> = {
  planning: 'Planning',
  development: 'Development',
  testing: 'Testing',
  review: 'Review',
  deployment: 'Deployment',
  completed: 'Completed',
};

async function api<T>(url: string, init?: RequestInit): Promise<{ data: T }> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const json = await res.json().catch(() => null);
  if (json?.error) throw new Error(json.error.message || 'Request failed');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return json;
}

function HealthBadge({ health }: { health: string | null }) {
  const h = HEALTH[health ?? 'on_track'] ?? HEALTH.on_track;
  const Icon = h.icon;
  return (
    <Badge variant="secondary" className={cn('gap-1', h.className)}>
      <Icon className="size-3" /> {h.label}
    </Badge>
  );
}

/**
 * Where a deliverable stands.
 *
 * Nothing at all for a file that was merely shared — a badge on every row would
 * make the ones that need a decision harder to find, which is the opposite of
 * the point.
 */
function DeliverableStatus({ file }: { file: Deliverable }) {
  if (!file.requiresApproval) return null;

  if (file.approvalDecision === 'approved') {
    return (
      <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <CheckCircle2 className="size-3" /> Approved
      </Badge>
    );
  }
  if (file.approvalDecision === 'rejected') {
    return (
      <Badge variant="secondary" className="gap-1 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
        <AlertTriangle className="size-3" /> Changes requested
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      <Clock className="size-3" /> Awaiting your approval
    </Badge>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Module
// ═══════════════════════════════════════════════════════════════════════════

export default function PortalModule() {
  const { activeRole } = useAppStore();
  const isClient = activeRole === 'client';

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Staff preview
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>('');

  const [openProject, setOpenProject] = useState<string | null>(null);

  /**
   * Staff need a company to preview. Clients never send one — the endpoint
   * resolves theirs from the session and ignores the parameter.
   */
  useEffect(() => {
    if (isClient) return;
    api<Company[]>('/api/crm/companies?pageSize=100')
      .then(res => {
        setCompanies(res.data ?? []);
        setCompanyId(prev => prev || res.data?.[0]?.id || '');
      })
      .catch(() => setCompanies([]));
  }, [isClient]);

  const load = useCallback(async (silent = false) => {
    if (!isClient && !companyId) { setLoading(false); return; }

    if (!silent) { setLoading(true); setError(null); }
    try {
      const url = isClient ? '/api/portal' : `/api/portal?companyId=${companyId}`;
      const res = await api<PortalData>(url);
      setData(res.data);
    } catch (e: any) {
      if (!silent) { setError(e.message || 'Could not load the portal'); setData(null); }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isClient, companyId]);

  useEffect(() => { load(); }, [load]);

  /**
   * The portal keeps itself current.
   *
   * Unfiltered rather than per-project: this screen is the *list*, and a client
   * with four engagements would otherwise need four subscriptions maintained as
   * the list changes. RLS already confines delivery to their own company's rows,
   * so the breadth costs nothing they should not receive.
   *
   * `invoices` and `announcements` are here as well as the project tables,
   * because both appear on this screen and neither is a project change.
   */
  useModuleRealtime(
    'portal',
    ['projects', 'tasks', 'milestones', 'files', 'invoices', 'support_tickets', 'announcements'],
    () => load(true),
    isClient || !!companyId,
  );

  if (openProject) {
    return (
      <PortalProjectView
        projectId={openProject}
        onBack={() => setOpenProject(null)}
        canReply={isClient}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-4 md:p-6">
      <PageHeader
        title={data?.company?.name ? `${data.company.name}` : 'Client Portal'}
        icon={Building2}
      >
        {/* Staff-only company switcher. A client has exactly one company and
            no switcher is rendered for them at all. */}
        {!isClient && (
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Choose a client" />
            </SelectTrigger>
            <SelectContent>
              {companies.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </PageHeader>

      {!isClient && (
        <p className="-mt-3 text-sm text-muted-foreground">
          This is exactly what this client sees when they sign in. Nothing here
          is editable from the portal.
        </p>
      )}

      {loading ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertTriangle}
          title="The portal could not be loaded"
          description={error}
        />
      ) : !data ? (
        <EmptyState
          icon={Building2}
          title="Choose a client"
          description="Pick a company above to see their portal."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Active projects" value={data.summary.activeProjects} icon={FolderKanban} />
            <StatCard label="Open tickets" value={data.summary.openTickets} icon={LifeBuoy} />
            <StatCard
              label="Outstanding"
              value={formatCurrency(data.summary.outstandingBalance, data.summary.currency)}
              icon={Receipt}
            />
            {/*
              Needs attention rather than a vanity metric. If something is off
              track the client should see it on the first screen, not three
              clicks in.
            */}
            <StatCard
              label="Needs attention"
              value={data.summary.projectsOffTrack + data.summary.projectsAtRisk}
              icon={AlertTriangle}
            />
          </div>

          {data.announcements.length > 0 && (
            <div className="flex flex-col gap-2">
              {data.announcements.slice(0, 3).map(a => (
                <Card key={a.id} className="border-emerald-500/30 bg-emerald-500/5">
                  <CardContent className="flex items-start gap-3 p-4">
                    <Megaphone className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{a.title}</p>
                      {a.body && <p className="mt-0.5 text-sm text-muted-foreground">{a.body}</p>}
                      <p className="mt-1 text-[11px] text-muted-foreground/70">
                        {formatDate(a.publishedAt)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Tabs defaultValue="projects" className="w-full">
            <TabsList>
              <TabsTrigger value="projects" className="gap-1.5">
                <FolderKanban className="size-4" /> Projects
              </TabsTrigger>
              <TabsTrigger value="invoices" className="gap-1.5">
                <Receipt className="size-4" /> Invoices
              </TabsTrigger>
              <TabsTrigger value="tickets" className="gap-1.5">
                <LifeBuoy className="size-4" /> Support
              </TabsTrigger>
            </TabsList>

            {/* ── Projects ────────────────────────────────────────────── */}
            <TabsContent value="projects" className="mt-4">
              {data.projects.length === 0 ? (
                <EmptyState
                  icon={FolderKanban}
                  title="No projects yet"
                  description="Projects shared with you will appear here."
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.projects.map(p => (
                    <Card
                      key={p.projectId}
                      className="cursor-pointer transition-shadow hover:shadow-md"
                      onClick={() => setOpenProject(p.projectId)}
                    >
                      <CardContent className="flex flex-col gap-3 p-5">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="line-clamp-1 font-semibold leading-tight text-foreground">
                            {p.name}
                          </h3>
                          <HealthBadge health={p.health} />
                        </div>

                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {p.description || 'No description'}
                        </p>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              {p.completedMilestones ?? 0} of {p.totalMilestones ?? 0} phases
                            </span>
                            <span className="font-medium">{p.progressPct ?? 0}%</span>
                          </div>
                          <Progress value={p.progressPct ?? 0} className="h-2" />
                        </div>

                        <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <CalendarDays className="size-3.5" />
                            {p.endDate ? formatDate(p.endDate) : 'No target date'}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="flex items-center gap-1">
                              <FileText className="size-3" />{p.deliverableCount ?? 0}
                            </span>
                            <span className="flex items-center gap-1">
                              <MessageSquare className="size-3" />{p.messageCount ?? 0}
                            </span>
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Invoices ────────────────────────────────────────────── */}
            <TabsContent value="invoices" className="mt-4">
              {data.invoices.length === 0 ? (
                <EmptyState icon={Receipt} title="No invoices" description="Invoices will appear here once issued." />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {data.invoices.map(inv => {
                        const outstanding = Number(inv.total) - Number(inv.amountPaid);
                        const overdue = inv.status === 'overdue';
                        return (
                          <div key={inv.id} className="flex items-center gap-4 p-4">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground">{inv.invoiceNumber}</p>
                              <p className="text-xs text-muted-foreground">
                                Issued {formatDate(inv.issueDate)} · due {formatDate(inv.dueDate)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium tabular-nums text-foreground">
                                {formatCurrency(Number(inv.total), inv.currency)}
                              </p>
                              {outstanding > 0 && (
                                <p className={cn(
                                  'text-xs tabular-nums',
                                  overdue ? 'text-destructive' : 'text-muted-foreground',
                                )}>
                                  {formatCurrency(outstanding, inv.currency)} outstanding
                                </p>
                              )}
                            </div>
                            <Badge
                              variant="secondary"
                              className={cn(
                                inv.status === 'paid' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                                overdue && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                              )}
                            >
                              {statusLabel(inv.status)}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ── Support ─────────────────────────────────────────────── */}
            <TabsContent value="tickets" className="mt-4">
              {data.tickets.length === 0 ? (
                <EmptyState icon={LifeBuoy} title="No tickets" description="Support requests you raise will appear here." />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {data.tickets.map(t => (
                        <div key={t.id} className="flex items-center gap-4 p-4">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{t.subject}</p>
                            <p className="text-xs text-muted-foreground">
                              {t.ticketNumber} · raised {formatDate(t.createdAt)}
                            </p>
                          </div>
                          <Badge variant="secondary">{statusLabel(t.status)}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  One project, as the client sees it
// ═══════════════════════════════════════════════════════════════════════════

function PortalProjectView({
  projectId, onBack, canReply,
}: {
  projectId: string;
  onBack: () => void;
  canReply: boolean;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  /** Which deliverable is mid-decision, so only its own buttons spin. */
  const [deciding, setDeciding] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Deliverable | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  /**
   * `silent` reloads without the skeleton.
   *
   * A realtime nudge or a decision that just succeeded should refresh the
   * numbers in place. Tearing the whole panel down to three grey blocks every
   * time a colleague completes a task elsewhere is worse than not updating at
   * all — the client loses their scroll position and whatever they were reading.
   */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api<ProjectDetail>(`/api/portal/projects/${projectId}`);
      setDetail(res.data);
    } catch (e: any) {
      if (!silent) toast.error(e.message || 'Could not load the project');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  /**
   * Live for the client too.
   *
   * The portal is the screen most likely to be left open — a client checks it,
   * leaves the tab, and comes back an hour later. Without this they are reading
   * an hour-old status report with no indication of it. Progress, milestones and
   * deliverables all move it, so all three are watched.
   */
  useProjectRealtime(projectId, () => load(true));

  const decide = useCallback(async (fileId: string, decision: 'approved' | 'rejected', note = '') => {
    setDeciding(fileId);
    try {
      await api(`/api/portal/deliverables/${fileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision, note }),
      });
      toast.success(decision === 'approved' ? 'Deliverable approved' : 'Sent back to the team');
      setRejecting(null);
      setRejectNote('');
      // Reloaded rather than patched in place: approving changes the project's
      // progress figure and its health verdict, both computed by the server.
      await load(true);
    } catch (e: any) {
      toast.error(e.message || 'Could not record your decision');
    } finally {
      setDeciding(null);
    }
  }, [load]);

  const send = useCallback(async () => {
    const body = reply.trim();
    if (!body) return;
    setSending(true);
    try {
      await api(`/api/portal/projects/${projectId}`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setReply('');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Could not send your message');
    } finally {
      setSending(false);
    }
  }, [reply, projectId, load]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (!detail) return null;

  const { project, milestones, deliverables, messages, timeline } = detail;
  // Defaulted, so a portal served by a deployment that predates the approvals
  // work renders rather than throwing on an absent key.
  const approvals = detail.approvals ?? { total: 0, pending: 0, approved: 0, rejected: 0 };
  const canDecideDeliverables = detail.canDecideDeliverables ?? false;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-4 md:p-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-2 gap-1.5">
          <ArrowLeft className="size-4" /> All projects
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {project.description || 'No description provided.'}
            </p>
          </div>
          <HealthBadge health={project.health} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Progress</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {project.progressPct ?? 0}%
            </p>
            <Progress value={project.progressPct ?? 0} className="mt-2 h-1.5" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Phases delivered</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {project.completedMilestones ?? 0}
              <span className="text-base text-muted-foreground"> / {project.totalMilestones ?? 0}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Target completion</p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {project.endDate ? formatDate(project.endDate) : 'Not set'}
            </p>
            {/* Said plainly. A portal that softens a missed date is one the
                client stops believing. */}
            {project.endDate && project.endDate < today && (
              <p className="mt-0.5 text-xs text-destructive">Past the agreed date</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="roadmap" className="w-full">
        <TabsList>
          <TabsTrigger value="roadmap" className="gap-1.5">
            <MilestoneIcon className="size-4" /> Roadmap
          </TabsTrigger>
          <TabsTrigger value="deliverables" className="gap-1.5">
            <FileText className="size-4" /> Deliverables
          </TabsTrigger>
          <TabsTrigger value="messages" className="gap-1.5">
            <MessageSquare className="size-4" /> Messages
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5">
            <CalendarDays className="size-4" /> Timeline
          </TabsTrigger>
        </TabsList>

        {/* ── Roadmap ──────────────────────────────────────────────────── */}
        <TabsContent value="roadmap" className="mt-4">
          {milestones.length === 0 ? (
            <EmptyState
              icon={MilestoneIcon}
              title="No roadmap published yet"
              description="Phases will appear here once the plan is agreed."
            />
          ) : (
            <div className="flex flex-col gap-6">
              {ROADMAP_STAGES.map(stage => {
                const inStage = milestones.filter(m => m.stage === stage);
                if (!inStage.length) return null;

                return (
                  <div key={stage}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {STAGE_LABELS[stage] ?? stage}
                    </h3>
                    <div className="flex flex-col gap-2">
                      {inStage.map(m => {
                        const overdue = !m.completedAt && m.dueDate && m.dueDate < today;
                        return (
                          <Card key={m.id} className={cn(overdue && 'border-destructive/40')}>
                            <CardContent className="flex items-start gap-3 p-4">
                              <div className={cn(
                                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                                m.completedAt ? 'bg-emerald-500 text-white' : 'border-2 border-muted-foreground/30',
                              )}>
                                {m.completedAt && <CheckCircle2 className="size-3.5" />}
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground">{m.name}</p>
                                {m.description && (
                                  <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]">
                                  {m.completedAt ? (
                                    <span className="text-emerald-600 dark:text-emerald-400">
                                      Delivered {formatDate(m.completedAt)}
                                    </span>
                                  ) : m.dueDate ? (
                                    <span className={overdue ? 'text-destructive' : 'text-muted-foreground'}>
                                      {overdue ? 'Overdue — was due ' : 'Due '}{formatDate(m.dueDate)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">No date set</span>
                                  )}
                                </div>
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
          )}
        </TabsContent>

        {/* ── Deliverables ─────────────────────────────────────────────── */}
        <TabsContent value="deliverables" className="mt-4">
          {deliverables.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nothing shared yet"
              description="Files published to you will appear here."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {/*
                Said once, at the top, when something is actually waiting.
                A count buried in a list is a count nobody acts on.
              */}
              {approvals.pending > 0 && (
                <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Clock className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm text-amber-900 dark:text-amber-200">
                      {approvals.pending === 1
                        ? 'One deliverable is waiting for your approval.'
                        : `${approvals.pending} deliverables are waiting for your approval.`}
                      {' '}The project cannot be reported complete until they are decided.
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {deliverables.map(f => (
                      <div key={f.id} className="flex flex-wrap items-center gap-3 p-4">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-foreground">{f.filename}</p>
                            <DeliverableStatus file={f} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {f.folder && `${f.folder} · `}
                            {formatFileSize(f.sizeBytes)} · {formatDate(f.createdAt)}
                          </p>
                          {/*
                            The reason a deliverable was sent back is the whole
                            point of recording a rejection, so it is shown rather
                            than hidden behind a hover.
                          */}
                          {f.approvalDecision === 'rejected' && f.approvalNote && (
                            <p className="mt-1 text-xs text-destructive">“{f.approvalNote}”</p>
                          )}
                          {f.approvalDecision === 'approved' && f.approvedAt && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Approved {formatDate(f.approvedAt)}
                              {f.approver?.profiles?.fullName ? ` by ${f.approver.profiles.fullName}` : ''}
                            </p>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {/*
                            Download goes through the signed-URL endpoint rather
                            than a stored path: the buckets are private, and the
                            link it mints expires in ten minutes.
                          */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            onClick={async () => {
                              try {
                                const res = await api<{ url: string }>(`/api/projects/files/${f.id}`);
                                if (res.data?.url) window.open(res.data.url, '_blank', 'noopener');
                              } catch (e: any) {
                                toast.error(e.message || 'Could not open that file');
                              }
                            }}
                          >
                            <Download className="size-3.5" /> Open
                          </Button>

                          {canDecideDeliverables && f.requiresApproval && !f.approvalDecision && (
                            <>
                              <Button
                                size="sm"
                                className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                                disabled={deciding === f.id}
                                onClick={() => decide(f.id, 'approved')}
                              >
                                {deciding === f.id
                                  ? <Loader2 className="size-3.5 animate-spin" />
                                  : <CheckCircle2 className="size-3.5" />}
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                disabled={deciding === f.id}
                                onClick={() => setRejecting(f)}
                              >
                                <AlertTriangle className="size-3.5" /> Request changes
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ── Messages ─────────────────────────────────────────────────── */}
        <TabsContent value="messages" className="mt-4">
          <div className="flex flex-col gap-4">
            {messages.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No messages yet"
                description="Updates shared with you will appear here."
              />
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map(m => (
                  <Card key={m.id}>
                    <CardContent className="flex items-start gap-3 p-4">
                      <Avatar className="size-8 shrink-0">
                        <AvatarFallback className="bg-emerald-100 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          {initialsOf(m.author?.profiles?.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {m.author?.profiles?.fullName || 'Team'}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatDate(m.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                          {m.body}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* The single write the portal permits. Shown only to clients —
                staff previewing should reply from the project's own
                discussion, where they can also post internal notes. */}
            {canReply && (
              <Card>
                <CardContent className="flex flex-col gap-2 p-4">
                  <Textarea
                    rows={3}
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    placeholder="Ask a question or reply to the team…"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={sending || !reply.trim()}
                      onClick={send}
                      className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                      Send
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Timeline ─────────────────────────────────────────────────── */}
        <TabsContent value="timeline" className="mt-4">
          {timeline.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Nothing scheduled" description="Dates will appear here as the plan takes shape." />
          ) : (
            <div className="relative flex flex-col gap-0 pl-6">
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
              {timeline.map((t, i) => (
                <div key={`${t.kind}-${t.id ?? i}`} className="relative flex gap-3 pb-5">
                  <span className={cn(
                    'absolute -left-6 top-1.5 size-[9px] rounded-full ring-4 ring-background',
                    t.kind === 'milestone_completed' || t.kind === 'deliverable_approved' ? 'bg-emerald-500'
                      : t.kind === 'milestone_overdue' || t.kind === 'deliverable_rejected' ? 'bg-destructive'
                      : t.kind === 'meeting' ? 'bg-blue-500'
                      : 'bg-muted-foreground/40',
                  )} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.detail} · {formatDate(t.at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/*
        Requesting changes needs a reason, so it is a dialog rather than a
        second button. The endpoint refuses a rejection with an empty note for
        the same reason: a deliverable sent back with no explanation is a round
        trip the team cannot act on.
      */}
      <Dialog
        open={!!rejecting}
        onOpenChange={open => { if (!open) { setRejecting(null); setRejectNote(''); } }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Request changes</DialogTitle>
            <DialogDescription>
              {rejecting?.filename} will be sent back to the team with your notes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reject-note">What needs changing?</Label>
            <Textarea
              id="reject-note"
              rows={4}
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              placeholder="The header colour is wrong and the totals on page 3 do not add up."
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setRejecting(null); setRejectNote(''); }}
            >
              Cancel
            </Button>
            <Button
              disabled={!rejectNote.trim() || deciding === rejecting?.id}
              onClick={() => rejecting && decide(rejecting.id, 'rejected', rejectNote.trim())}
            >
              {deciding === rejecting?.id && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
