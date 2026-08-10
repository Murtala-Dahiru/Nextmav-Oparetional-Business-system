import {
  Users,
  FolderKanban,
  UserCog,
  Wallet,
  Boxes,
  MessagesSquare,
  LifeBuoy,
  CalendarDays,
  Building2,
  ShieldCheck,
  BarChart3,
  ShoppingCart,
  Package,
  FileText,
  CheckSquare,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The capability map
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Why this file exists ─────────────────────────────────────────────────
 *
 *  Two descriptions of this product were in circulation. `lib/constants.ts`
 *  lists thirteen modules that are built. The uploaded public-experience
 *  project describes twelve capabilities, seven of which are not built — and
 *  it omits CRM, inventory, support, the calendar and the client portal, which
 *  are.
 *
 *  Deleting the seven made the site accurate and made the product look smaller
 *  than it is. Printing them as though they shipped would be a promise a trial
 *  cannot keep, and a features page is exactly the document a disappointed
 *  buyer quotes back at you.
 *
 *  So neither. Every capability in either description appears here, and each
 *  one carries a `status` that is shown on the page. A public roadmap is a
 *  normal artefact for serious enterprise software — it is how a buyer plans a
 *  rollout — and stating plainly what is live, what is partial and what is
 *  coming reads as confidence rather than as hedging. The alternative, an
 *  undifferentiated list, forces the reader to assume the worst about all of
 *  it.
 *
 *  ── The rule for changing this file ──────────────────────────────────────
 *
 *  `live` means a person with the right role can do the thing today, in a
 *  trial account, without contacting anyone. Anything short of that is
 *  `partial` or `planned`. Promoting an entry is a product decision, not a
 *  copy decision — check the module exists in `lib/constants.ts` and that the
 *  routes behind it are reachable before moving one up.
 */

export type CapabilityStatus = 'live' | 'partial' | 'planned';

export type Capability = {
  id: string;
  icon: LucideIcon;
  name: string;
  /** One line. What it is, not why it is good. */
  summary: string;
  status: CapabilityStatus;
  /** Shown only on `partial` and `planned`, to say exactly where the line is. */
  note?: string;
  tags: string[];
};

export const STATUS_LABEL: Record<CapabilityStatus, string> = {
  live: 'Available',
  partial: 'Partly available',
  planned: 'In development',
};

/**
 * Ordered as the page reads them: everything a workspace can do today, then
 * what is being built. Within each band, the areas a buyer asks about first.
 */
export const CAPABILITIES: Capability[] = [
  {
    id: 'identity',
    icon: ShieldCheck,
    name: 'Identity & access',
    summary:
      'Authentication, roles, permissions, session policy, account verification and password management — one model, enforced server-side on every request.',
    status: 'live',
    tags: ['Role-based access', 'Session policy', 'Audit trail'],
  },
  {
    id: 'crm',
    icon: Users,
    name: 'CRM & sales',
    summary:
      'Leads, contacts and companies, a pipeline with stages you define, and the activity logged against the record it concerns.',
    status: 'live',
    tags: ['Pipeline', 'Contacts', 'Activity'],
  },
  {
    id: 'projects',
    icon: FolderKanban,
    name: 'Projects & work',
    summary:
      'Boards, tasks, milestones, comments, attachments and time — assigned to people, rolled up per project.',
    status: 'live',
    tags: ['Boards', 'Milestones', 'Time'],
  },
  {
    id: 'people',
    icon: UserCog,
    name: 'People & HR',
    summary:
      'The employee record, departments and reporting lines, leave with balances and approval, attendance, invitations and offboarding.',
    status: 'live',
    tags: ['Employee record', 'Leave', 'Attendance'],
  },
  {
    id: 'finance',
    icon: Wallet,
    name: 'Finance',
    summary:
      'Invoices with line items and payment tracking, expenses with categories and approval, tied to the customer and project that caused them.',
    status: 'live',
    tags: ['Invoices', 'Expenses', 'Ageing'],
  },
  {
    id: 'inventory',
    icon: Boxes,
    name: 'Inventory & supply',
    summary:
      'Products, variants and stock per warehouse, movements with a history to read, suppliers, purchase orders and low-stock thresholds.',
    status: 'live',
    tags: ['Stock', 'Suppliers', 'Purchase orders'],
  },
  {
    id: 'communication',
    icon: MessagesSquare,
    name: 'Communication',
    summary:
      'Channels and direct messages delivered live, file sharing under workspace retention, and meetings between participants.',
    status: 'live',
    tags: ['Channels', 'Files', 'Meetings'],
  },
  {
    id: 'support',
    icon: LifeBuoy,
    name: 'Support & client portal',
    summary:
      'Tickets with owners, priority and response targets, and a portal where a customer sees only their own.',
    status: 'live',
    tags: ['Tickets', 'Response targets', 'Portal'],
  },
  {
    id: 'calendar',
    icon: CalendarDays,
    name: 'Calendar',
    summary:
      'One schedule drawn from project milestones, meetings, deadlines, leave and holidays, per person and per team.',
    status: 'live',
    tags: ['Schedule', 'Deadlines', 'Leave'],
  },
  {
    id: 'dashboards',
    icon: BarChart3,
    name: 'Dashboards & reporting',
    summary:
      'Company health, department performance and project status, drawn from the modules rather than typed into a report.',
    status: 'live',
    tags: ['Executive view', 'Department metrics'],
  },
  {
    id: 'approvals',
    icon: CheckSquare,
    name: 'Approvals & workflows',
    summary:
      'Requests route to the person entitled to decide them, and the decision stays attached to the record.',
    status: 'partial',
    note: 'Available today for leave, expenses and project sign-off. A configurable multi-step workflow builder is being built.',
    tags: ['Leave', 'Expenses', 'Sign-off'],
  },
  {
    id: 'organization',
    icon: Building2,
    name: 'Organization structure',
    summary:
      'Organizations, departments, teams and reporting lines that drive who sees what, rather than a permissions matrix maintained by hand.',
    status: 'partial',
    note: 'Organizations, departments and reporting lines are live. Business units, branches and cost centres are in development.',
    tags: ['Departments', 'Reporting lines'],
  },
  {
    id: 'procurement',
    icon: ShoppingCart,
    name: 'Procurement',
    summary:
      'Purchase requests through approval to order, with vendor records and contracts against the spend they explain.',
    status: 'planned',
    note: 'Purchase orders and suppliers exist today inside Inventory. Requests, vendor management and contracts are in development.',
    tags: ['Requests', 'Vendors', 'Contracts'],
  },
  {
    id: 'assets',
    icon: Package,
    name: 'Assets',
    summary:
      'An asset register with allocation, ownership and maintenance history, linked to the person and location holding it.',
    status: 'planned',
    note: 'In development. Asset assignment against the employee record is the first piece.',
    tags: ['Register', 'Allocation', 'Maintenance'],
  },
  {
    id: 'documents',
    icon: FileText,
    name: 'Documents',
    summary:
      'Company and employee documents with version history, organization-wide search, sharing and the same permission model as everything else.',
    status: 'planned',
    note: 'File storage and sharing are live inside Communication and Projects. A document module with version history is in development.',
    tags: ['Version history', 'Search', 'Permissions'],
  },
  {
    id: 'intelligence',
    icon: Sparkles,
    name: 'Operational intelligence',
    summary:
      'Summaries, risk signals and search over the operational record — reading the same rows, under the same permissions.',
    status: 'planned',
    note: 'In development. Nothing here reads data a person could not already open themselves.',
    tags: ['Summaries', 'Risk signals', 'Search'],
  },
];

export const LIVE_CAPABILITIES = CAPABILITIES.filter((c) => c.status === 'live');
export const FORTHCOMING_CAPABILITIES = CAPABILITIES.filter((c) => c.status !== 'live');
