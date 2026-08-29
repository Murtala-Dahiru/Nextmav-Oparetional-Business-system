import type { Severity } from '@/components/shared/readout/severity';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What the CRM's endpoints actually return
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Written against the responses, not against the tables. Where the two differ
 * the difference is called out, because the previous version of this module
 * declared `company` on a lead (the column is `company_name`) and `company` as
 * a string on a contact (the endpoint embeds an object) - the second of which
 * put an object into a table cell and took the whole Contacts screen down
 * through the module error boundary.
 */

export interface ApiMeta {
  total: number; page: number; pageSize: number; totalPages: number;
}

/** The embedded member shape every CRM endpoint returns for an owner. */
export interface Member {
  id: string;
  profiles?: { fullName: string; avatarUrl: string | null };
}

export interface Lead {
  id: string;
  firstName: string; lastName: string;
  email: string; phone: string;
  /** `leads.company_name` - free text. A lead has no company *record* until it converts. */
  companyName: string;
  jobTitle: string;
  source: string; status: string;
  score: number;
  estimatedValue: number;
  notes: string;
  ownerId: string;
  convertedContactId: string | null;
  convertedAt: string | null;
  createdAt: string; updatedAt: string;
  owner?: Member;
}

export interface Contact {
  id: string;
  firstName: string; lastName: string;
  email: string; phone: string;
  jobTitle: string;
  companyId: string | null;
  source: string;
  isActive: boolean;
  notes: string;
  createdAt: string; updatedAt: string;
  /** Embedded, not a string. Rendering this straight into JSX is what crashed. */
  company?: { id: string; name: string } | null;
}

export interface Company {
  id: string;
  name: string; industry: string; website: string;
  phone: string; email: string;
  address: string; city: string; country: string;
  employeeCount: number; annualRevenue: number;
  notes: string;
  ownerId: string | null;
  createdAt: string; updatedAt: string;
}

export interface Deal {
  id: string;
  name: string;
  value: number;
  stage: string;
  probability: number;
  /** A `date` column. Never pass this to `formatDate` - see `formatDay`. */
  expectedClose: string | null;
  closedAt: string | null;
  lostReason: string | null;
  companyId: string | null;
  contactId: string | null;
  notes: string;
  ownerId: string;
  createdAt: string; updatedAt: string;
  company?: { id: string; name: string } | null;
  contact?: { id: string; firstName: string; lastName: string } | null;
  owner?: Member;
}

/**
 * A call, an email, a meeting, a note - or a follow-up that has not happened.
 *
 * `dueAt` and `completedAt` are what separate the two: a row with a `dueAt` and
 * no `completedAt` is work owed, everything else is history. See migration
 * 0028 for why they are one table.
 */
export interface CrmActivity {
  id: string;
  activityType: string;
  subject: string;
  body: string;
  dueAt: string | null;
  remindAt: string | null;
  completedAt: string | null;
  createdAt: string;
  memberId: string | null;
  member?: Member | null;
  company?: { id: string; name: string } | null;
  contact?: { id: string; firstName: string; lastName: string } | null;
  lead?: { id: string; firstName: string; lastName: string } | null;
  deal?: { id: string; name: string } | null;
  /** Added by `/api/crm/overview`, which knows the organisation's calendar. */
  when?: 'overdue' | 'today' | 'upcoming';
}

/* -------------------------------------------------------------------------- */
/*  /api/crm/overview                                                         */
/* -------------------------------------------------------------------------- */

export interface StageRow {
  stage: string;
  count: number;
  value: number;
  weighted: number;
}

export interface OwnerRow {
  memberId: string;
  name: string;
  wonValue: number;
  wonCount: number;
  lostCount: number;
  openValue: number;
  openCount: number;
  winRate: number | null;
}

export interface MonthRow {
  period: string;
  won: number; wonCount: number;
  lost: number; lostCount: number;
}

export interface CrmOverview {
  /** What the caller's role lets them see. `own` narrows every figure here. */
  scope: 'own' | 'department' | 'organization';
  currency: string;
  sees: { finance: boolean; projects: boolean; support: boolean };

  revenue: {
    wonThisMonth: number;
    wonLastMonth: number;
    wonThisYear: number;
    wonAll: number;
    lostAll: number;
    pipelineValue: number;
    weightedPipeline: number;
    openCount: number;
    wonCount: number;
    lostCount: number;
    /** Over the last twelve months, or null when nothing has been decided. */
    winRate: number | null;
    averageDeal: number;
    /** Days from a deal being written down to it being won, or null. */
    averageCycleDays: number | null;
    byMonth: MonthRow[];
  };

  stages: StageRow[];
  owners: OwnerRow[];

  leads: {
    total: number; open: number; won: number; lost: number;
    converted: number;
    conversionRate: number | null;
    byStatus: { status: string; count: number; value: number }[];
    unworked: Lead[];
  };

  movement: { advanced: number; slipped: number; total: number };
  activityByWeek: { week: string; count: number }[];

  closingSoon: Deal[];
  stale: Deal[];
  topDeals: Deal[];
  followups: CrmActivity[];
  recentActivity: CrmActivity[];
}

/* -------------------------------------------------------------------------- */
/*  The action centre                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One thing that needs a salesperson.
 *
 * Same shape as the Executive Overview's queue, deliberately: the two screens
 * answer the same question at different altitudes, and a reader who has learnt
 * to scan one should not have to learn the other. `state` restates the rule
 * that produced the row rather than measuring anything.
 */
export interface CrmAttentionItem {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  state: string;
  /** Where it is dealt with, inside CRM. */
  go: { label: string; section: CrmSection; focus?: { type: string; id: string } };
}

export type CrmSection =
  | 'home' | 'leads' | 'contacts' | 'companies'
  | 'deals' | 'pipeline' | 'activities' | 'import';

/* -------------------------------------------------------------------------- */
/*  Vocabulary                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The pipeline, in order.
 *
 * Duplicated from `lib/constants` deliberately *not*: it is imported. What is
 * here is the presentation - the words shown, and where each stage sits in the
 * sequence, which is what "advanced" and "slipped" are measured against.
 */
export const STAGE_LABELS: Record<string, string> = {
  prospecting: 'Prospecting',
  qualification: 'Qualification',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closed_won: 'Won',
  closed_lost: 'Lost',
};

export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

export const OPEN_STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation'];
export const CLOSED_STAGES = ['closed_won', 'closed_lost'];

/**
 * The activity vocabulary.
 *
 * `crm_activities.activity_type` is free text in the database, so this is the
 * set the product offers rather than a constraint. Anything else that turns up
 * - from an import, or from a row written before this list existed - renders
 * with its own name and the neutral icon rather than disappearing.
 */
export const ACTIVITY_TYPES = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'video', label: 'Video call' },
  { value: 'visit', label: 'Visit' },
  { value: 'demo', label: 'Demo' },
  { value: 'proposal', label: 'Proposal sent' },
  { value: 'followup', label: 'Follow-up' },
  { value: 'note', label: 'Note' },
  { value: 'other', label: 'Other' },
] as const;

export const SOURCE_OPTIONS = [
  { value: 'manual', label: 'Added by hand' },
  { value: 'web', label: 'Website' },
  { value: 'referral', label: 'Referral' },
  { value: 'event', label: 'Event' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'partner', label: 'Partner' },
  { value: 'social', label: 'Social' },
  { value: 'email', label: 'Email' },
  { value: 'import', label: 'Imported' },
];

/**
 * Why a deal was lost.
 *
 * A short closed list rather than a free-text box, because the whole value of
 * the field is being able to count it - "we lost eleven deals" and "we lost
 * eleven deals on price" are different sentences, and only the second one
 * changes what anybody does. `Other` keeps the note field honest for the cases
 * the list does not cover.
 */
export const LOST_REASONS = [
  'Price', 'Timing', 'Went with a competitor', 'No budget',
  'No decision', 'Not a fit', 'No response', 'Other',
];
