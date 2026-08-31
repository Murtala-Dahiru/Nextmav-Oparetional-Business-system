import type { ModuleId } from '@/lib/constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What a project is, on the screen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every shape here is what an endpoint actually returns, in the camelCase
 * `api-response.success()` converts to. Nothing is aspirational: if a field is
 * declared, some route selects it, and if a route stopped selecting it this
 * file would be the lie rather than the contract.
 */

export interface ApiMeta { total: number; page: number; pageSize: number; totalPages: number }

/** A colleague, as `/api/directory` returns them. */
export interface Member {
  memberId: string;
  userId?: string;
  fullName: string;
  email?: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  /**
   * Coarse presence. Three states and no timestamp: the directory deliberately
   * withholds `last_seen_at`, because "online" is something a colleague can
   * infer from chat anyway while "last active 03:12" says what hours somebody
   * keeps.
   */
  presence?: 'online' | 'away' | 'offline';
}

/** An embedded `organization_members` row with its profile. */
export interface Person {
  id: string;
  profiles?: { fullName: string; avatarUrl: string | null; jobTitle?: string | null } | null;
}

export type Health = 'on_track' | 'at_risk' | 'off_track';

/**
 * A row of the delivery portfolio, from `/api/projects/overview`.
 *
 * Progress, health and every count come from `v_project_health`, which is the
 * single definition shared with the board, the dashboard, the reports and the
 * client portal. Nothing on this screen recomputes any of them.
 */
export interface PortfolioProject {
  id: string;
  name: string;
  status: string;
  priority: string;
  budget: number;
  startDate: string | null;
  endDate: string | null;
  description: string;
  updatedAt: string | null;
  owner: Person | null;
  client: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  health: Health;
  progressPct: number;
  planPct: number;
  executionPct: number;
  acceptancePct: number;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  totalMilestones: number;
  completedMilestones: number;
  overdueMilestones: number;
  totalDeliverables: number;
  pendingDeliverables: number;
  approvedDeliverables: number;
  daysRemaining: number | null;
  loggedHours: number;
  memberCount: number;
  isMine: boolean;
  isOverdue: boolean;
  /** The nearest unfinished phase with a date, or null. */
  nextMilestone: NextMilestone | null;
}

export interface NextMilestone {
  id: string;
  name: string;
  dueDate: string;
  stage: string;
}

export type Severity = 'critical' | 'high' | 'medium';

export interface AttentionRow {
  severity: Severity;
  projectId: string;
  title: string;
  detail: string;
}

export interface UpcomingMilestone {
  id: string;
  name: string;
  stage: string;
  dueDate: string;
  projectId: string;
  projectName: string;
  owner: string | null;
  overdue: boolean;
}

export interface PortfolioOverview {
  today: string;
  horizonDays: number;
  projects: PortfolioProject[];
  attention: AttentionRow[];
  upcoming: UpcomingMilestone[];
  waitingOnClient: {
    id: string; filename: string; projectId: string; projectName: string; since: string;
  }[];
  recentlyCompleted: {
    id: string; title: string; projectId: string; projectName: string; at: string; by: string | null;
  }[];
  /** Twelve weeks of finished work, oldest bucket first. */
  completionTrend: { weekStart: string; count: number }[];
  /** Open work per person across every live project, heaviest first. */
  workload: {
    memberId: string; name: string; avatarUrl: string | null;
    open: number; overdue: number;
  }[];
  /** Open work nobody is holding. Counted apart, never folded into a person. */
  unassignedOpen: number;
  totals: {
    live: number; active: number; onTrack: number; atRisk: number; offTrack: number;
    overdue: number; mine: number; blockedTasks: number; overdueTasks: number;
    openTasks: number; completedTasks: number; awaitingClient: number;
  };
}

/* -------------------------------------------------------------------------- */
/*  The workspace                                                             */
/* -------------------------------------------------------------------------- */

export interface Milestone {
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

export interface ProjectMember {
  id: string;
  role: string;
  allocationPct: number;
  joinedAt: string;
  member?: (Person & { role?: string; departmentId?: string | null }) | null;
}

export interface WorkspaceTask {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string | null;
  milestoneId: string | null;
  parentTaskId: string | null;
  estimatedHours: number;
  loggedHours: number;
  createdAt: string;
  completedAt: string | null;
  sortOrder: number;
  assignee?: Person | null;
}

/** A task as the Tasks section lists it, with its project embedded. */
export interface Task extends WorkspaceTask {
  assigneeId: string | null;
  projectId: string | null;
  updatedAt: string;
  project?: { id: string; name: string } | null;
}

export interface ProjectFile {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  folder: string;
  isClientVisible: boolean;
  isConfidential: boolean;
  /** Set when the resource lives elsewhere. See migration 0034. */
  externalUrl: string | null;
  requiresApproval: boolean;
  approvalDecision: 'approved' | 'rejected' | null;
  approvedAt: string | null;
  approvalNote: string;
  createdAt: string;
  uploader?: Person | null;
  approver?: Person | null;
}

export interface Comment {
  id: string;
  body: string;
  mentions: string[];
  isClientVisible: boolean;
  createdAt: string;
  editedAt: string | null;
  parentId: string | null;
  authorId: string;
  author?: Person | null;
}

export interface Dependency {
  id: string;
  taskId: string;
  dependsOnId: string;
  task?: { id: string; title: string; status: string; projectId: string } | null;
  dependsOn?: { id: string; title: string; status: string; projectId: string } | null;
}

export interface Risk { kind: string; id: string; title: string; owner: string | null; detail: string }

export interface TimelineEntry {
  at: string;
  kind: string;
  title: string;
  detail: string;
  id?: string;
  by?: string | null;
}

/** `v_project_health`, one row, as the overview endpoint returns it. */
export interface ProjectHealth {
  progressPct: number;
  planPct: number;
  executionPct: number;
  acceptancePct: number;
  health: Health;
  totalTasks: number;
  completedTasks: number;
  reviewTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  totalMilestones: number;
  completedMilestones: number;
  overdueMilestones: number;
  totalDeliverables: number;
  approvedDeliverables: number;
  pendingDeliverables: number;
  daysRemaining: number | null;
  loggedHours: number;
  memberCount: number;
}

export interface Workspace {
  project: {
    id: string;
    name: string;
    description: string;
    status: string;
    priority: string;
    startDate: string | null;
    endDate: string | null;
    budget: number;
    clientCompanyId: string | null;
    owner?: Person | null;
    department?: { id: string; name: string } | null;
    client?: { id: string; name: string; industry?: string | null } | null;
  };
  health: ProjectHealth | null;
  members: ProjectMember[];
  milestones: Milestone[];
  tasks: WorkspaceTask[];
  dependencies: Dependency[];
  files: ProjectFile[];
  comments: Comment[];
  timeline: TimelineEntry[];
  risks: Risk[];
  blockers: Risk[];
  deliverables: { total: number; pending: number; rejected: number; approved: number };
  /**
   * `null` when the reader holds no finance grant.
   *
   * Not an empty object: RLS would hand them zero invoices either way, and
   * rendering that as "nothing billed" is a statement rather than an absence.
   */
  finance: {
    invoices: {
      id: string; invoiceNumber: string; status: string; issueDate: string;
      dueDate: string; total: number; amountPaid: number; currency: string;
    }[];
    expenses: {
      id: string; title: string; amount: number; category: string;
      status: string; expenseDate: string;
    }[];
  } | null;
}

/* -------------------------------------------------------------------------- */
/*  Vocabulary                                                                */
/* -------------------------------------------------------------------------- */

export type Section = 'home' | 'projects' | 'tasks';

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  // `project_status` has carried this since 0001 and no label map had it, so a
  // cancelled project printed the raw enum in the one place a reader looks
  // first.
  cancelled: 'Cancelled',
  archived: 'Archived',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'In review',
  // Same omission, with a worse consequence: `blocked` is the status the whole
  // attention queue is built on, and the table rendered it as "blocked" with
  // no styling while the filter offered it under its database spelling.
  blocked: 'Blocked',
  done: 'Done',
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const STAGE_LABELS: Record<string, string> = {
  planning: 'Planning',
  development: 'Development',
  testing: 'Testing',
  review: 'Review',
  deployment: 'Deployment',
  completed: 'Completed',
};

export const HEALTH_LABELS: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'Needs attention',
  off_track: 'Off track',
};

/** The `priority_level` enum, named once rather than as three array literals. */
export const PRIORITY_VALUES = ['low', 'medium', 'high', 'critical'];

/** Where a task can go on a board, in the order work moves through it. */
export const TASK_FLOW = ['todo', 'in_progress', 'review', 'blocked', 'done'];

export const MODULE: ModuleId = 'projects';
