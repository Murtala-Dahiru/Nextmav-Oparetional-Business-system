import type {
  EmploymentStage, EmploymentEventKind, ApplicationStage, ApplicationStatus,
  OpeningStatus, OfferStatus, JourneyKind, ChecklistCategory, ExitType,
  PayrollRunStatus, HrCaseCategory, HrCaseStatus, HrDocumentCategory,
  PayPeriodId, CompChangeReason, HireRecommendation,
} from '@/lib/hr';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What the HR endpoints actually return.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **camelCase, because `api-response` converts every key on the way out.**
 * That is the one thing to get right here, and it is the thing this repository
 * has got wrong seven times: a component declaring `interface Lead { company:
 * string }` against an endpoint returning `companyName` compiles, fetches,
 * renders blank, and fails nothing. `npm run contract:check` exists because
 * each of those cost a manual audit to find, and it compares these interfaces
 * with a real response - so a field renamed here and not there is caught.
 *
 * The relation shapes are the second half of the same trap. A joined member
 * arrives as `{ id, profiles: { fullName, avatarUrl } }` - the profile is
 * nested, because that is how the join is written - and `owner?: { firstName }`
 * against exactly this shape is how the project board came to show a blank
 * owner on every card.
 */

export interface ApiMeta { total: number; page: number; pageSize: number; totalPages: number }

/** The nested profile every joined membership carries. */
export interface JoinedProfile { fullName: string; avatarUrl: string | null }
export interface JoinedMember {
  id: string;
  departmentId?: string | null;
  profiles?: JoinedProfile;
  department?: { id: string; name: string } | null;
}

/** A row of `v_hr_people` - the directory as HR needs it. */
export interface Person {
  memberId: string;
  organizationId: string;
  userId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
  /** The membership's title where set, the profile's otherwise. */
  jobTitle: string | null;
  role: string;
  employeeNumber: string | null;
  employmentType: string;
  lifecycleStage: EmploymentStage;
  status: 'active' | 'suspended' | 'terminated';
  isActive: boolean;
  hiredOn: string | null;
  joinedAt: string;
  terminatedOn: string | null;
  probationEndsOn: string | null;
  workLocation: string | null;
  departmentId: string | null;
  departmentName: string | null;
  managerId: string | null;
  managerName: string | null;
  managerAvatarUrl: string | null;
  tenureMonths: number | null;
  accountOrigin: string | null;
  lastSeenAt: string | null;
  lastActiveAt: string | null;
  presence: 'online' | 'away' | 'offline';
}

export interface EmploymentEvent {
  id: string;
  memberId: string;
  kind: EmploymentEventKind;
  effectiveOn: string;
  titleBefore: string | null;
  titleAfter: string | null;
  departmentBefore: string | null;
  departmentAfter: string | null;
  managerBefore: string | null;
  managerAfter: string | null;
  employmentTypeBefore: string | null;
  employmentTypeAfter: string | null;
  stageBefore: EmploymentStage | null;
  stageAfter: EmploymentStage | null;
  reason: string;
  note: string;
  createdAt: string;
  recorder?: { id: string; profiles?: JoinedProfile } | null;
  departmentFrom?: { id: string; name: string } | null;
  departmentTo?: { id: string; name: string } | null;
  /** Sent by /api/hr/overview's activity feed, which joins the subject. */
  member?: { id: string; profiles?: JoinedProfile } | null;
}

/* -------------------------------------------------------------------------- */
/*  HR Home                                                                   */
/* -------------------------------------------------------------------------- */

export interface WorkforceTrendPoint { month: string; headcount: number; joined: number; left: number }

export interface Overview {
  asOf: string;
  scope: { role: string; memberId: string; visiblePeople: number };
  workforce: {
    headcount: number;
    active: number;
    onboarding: number;
    onLeaveStage: number;
    leaving: number;
    former: number;
    byStage: Record<string, number>;
    byType: Record<string, number>;
    byDepartment: { id: string | null; name: string; count: number }[];
    newHires: number;
    newHires90: number;
    departures: number;
    departures90: number;
    /** Null rather than zero when there is nobody to divide by. */
    turnover90: number | null;
    trend: WorkforceTrendPoint[];
    medianTenureMonths: number | null;
  };
  attendanceToday: {
    date: string;
    expected: number;
    recorded: number;
    present: number;
    remote: number;
    late: number;
    absent: number;
    stillIn: number;
    onLeave: number;
    /** Neither a record nor leave. Not the same as absent, and never drawn as it. */
    unrecorded: number;
  };
  peopleOnLeaveToday: LeaveRow[];
  leave: {
    pending: number;
    pendingRequests: LeaveRow[];
    upcoming: LeaveRow[];
    myBalances: LeaveBalance[];
  };
  events: {
    starting: Person[];
    anniversaries: (Person & { date: string; years: number })[];
    probationEnding: Person[];
    leaving: Person[];
  };
  journeys: {
    onboarding: JourneySummary[];
    offboarding: JourneySummary[];
    overdueSteps: number;
  };
  recruitment: {
    openOpenings: number;
    openings: Opening[];
    activeApplications: number;
    byStage: Record<string, number>;
    interviewsThisWeek: Interview[];
    positions: number;
  };
  cases: {
    open: number;
    mine: number;
    assignedToMe: number;
    unassigned: number;
    recent: HrCase[];
  };
  payroll: { periods: PayrollPeriod[]; awaitingApproval: number };
  activity: EmploymentEvent[];
}

export interface JourneySummary {
  id: string;
  kind: JourneyKind;
  anchorDate: string;
  memberId: string;
  member?: JoinedMember;
  total: number;
  done: number;
  percent: number;
  overdue: number;
}

/* -------------------------------------------------------------------------- */
/*  Employee 360                                                              */
/* -------------------------------------------------------------------------- */

export interface LeaveRow {
  id: string;
  memberId: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  daysRequested?: number;
  isHalfDay?: boolean;
  reason?: string;
  decidedAt?: string | null;
  createdAt?: string;
  member?: JoinedMember;
}

export interface LeaveBalance {
  id?: string;
  memberId?: string;
  type: string;
  year: number;
  entitledDays: number;
  usedDays: number;
  carriedDays: number;
  totalDays: number;
  remainingDays: number;
  impliedUsedDays?: number;
  needsReconciliation?: boolean;
  member?: JoinedMember;
}

export interface AttendanceRow {
  id: string;
  workDate: string;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  workedMinutes: number;
  lateMinutes: number;
  isRemote: boolean;
  note: string;
  adjustedAt: string | null;
}

export interface AttendanceSummary {
  from: string; to: string; days: number;
  present: number; absent: number; onLeave: number; remote: number; late: number;
  totalMinutes: number; averageMinutes: number;
  punctualityRate: number | null;
}

export interface CompensationRecord {
  id: string;
  memberId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  baseAmount: number;
  currency: string;
  payPeriod: PayPeriodId;
  changeReason: CompChangeReason;
  note: string;
  createdAt: string;
  approver?: { id: string; profiles?: JoinedProfile } | null;
  member?: JoinedMember;
}

export interface CompensationComponent {
  id: string;
  memberId: string;
  code: string;
  label: string;
  kind: 'earning' | 'deduction' | 'employer_cost';
  calculation: 'fixed' | 'percent_of_base';
  amount: number | null;
  rate: number | null;
  isTaxable: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string;
}

export interface HrDocument {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  hrCategory: HrDocumentCategory;
  memberId: string | null;
  hrCaseId: string | null;
  isConfidential: boolean;
  createdAt: string;
  bucket?: string;
  path?: string;
  subject?: JoinedMember | null;
  uploader?: { id: string; profiles?: JoinedProfile } | null;
}

export interface Profile360 {
  person: Person;
  viewer: { isSelf: boolean; isHr: boolean; canSeeCompensation: boolean };
  history: EmploymentEvent[];
  reports: Pick<Person, 'memberId' | 'fullName' | 'avatarUrl' | 'jobTitle' | 'lifecycleStage' | 'departmentName'>[];
  attendance: { summary: AttendanceSummary; records: AttendanceRow[] };
  leave: { requests: LeaveRow[]; balances: LeaveBalance[] };
  performance: {
    goals: { id: string; title: string; kind: string; status: string; targetValue: number | null; currentValue: number | null; unit: string | null; dueOn: string | null }[];
    reviews: { id: string; status: string; overallRating: number | null; sharedAt: string | null; closedAt: string | null; createdAt: string; cycle?: { id: string; name: string; periodStart: string; periodEnd: string } | null }[];
    achievements: { id: string; title: string; description: string; happenedOn: string }[];
  };
  documents: HrDocument[];
  journeys: Journey[];
  work: {
    projects: { role: string; allocationPct: number; project?: { id: string; name: string; status: string; endDate: string | null } | null }[];
    tasks: { id: string; title: string; status: string; priority: string; dueDate: string | null; project?: { id: string; name: string } | null }[];
  };
  cases: HrCase[];
  origin: {
    id: string; source: string; createdAt: string;
    applications?: { id: string; appliedOn: string; opening?: { id: string; title: string; reference: string } | null }[];
  } | null;
  exit: EmployeeExit | null;
  /** Absent entirely when the caller may not see it - not an empty object. */
  compensation?: {
    records: CompensationRecord[];
    components: CompensationComponent[];
    current: CompensationRecord | null;
  };
}

/* -------------------------------------------------------------------------- */
/*  Organisation                                                              */
/* -------------------------------------------------------------------------- */

export interface OrgDepartment {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  headId: string | null;
  costCentre: string | null;
  memberCount: number;
  headName: string | null;
}

export interface OrgChart {
  departments: OrgDepartment[];
  unassignedCount: number;
  people: Person[];
  teams: { id: string; name: string; description: string; departmentId: string | null; leadId: string | null; members: { memberId: string; role: string }[] }[];
}

/* -------------------------------------------------------------------------- */
/*  Recruitment                                                               */
/* -------------------------------------------------------------------------- */

export interface Opening {
  id: string;
  reference: string;
  title: string;
  departmentId: string | null;
  hiringManagerId: string | null;
  recruiterId: string | null;
  employmentType: string;
  workMode: string;
  location: string;
  positions: number;
  description: string;
  requirements: string;
  status: OpeningStatus;
  openedOn: string | null;
  targetStartOn: string | null;
  closedOn: string | null;
  createdAt: string;
  department?: { id: string; name: string } | null;
  hiringManager?: { id: string; profiles?: JoinedProfile } | null;
  recruiter?: { id: string; profiles?: JoinedProfile } | null;
  pipeline?: { total: number; active: number; hired: number };
  applications?: Application[];
}

export interface Candidate {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  headline: string;
  location: string;
  source: string;
  referredBy: string | null;
  profileUrl: string | null;
  resumeFileId: string | null;
  notes: string;
  hiredMemberId: string | null;
  createdAt: string;
  referrer?: { id: string; profiles?: JoinedProfile } | null;
  applications?: Application[];
}

export interface Application {
  id: string;
  openingId: string;
  candidateId: string;
  stage: ApplicationStage;
  status: ApplicationStatus;
  appliedOn: string;
  rating: number | null;
  outcomeReason: string;
  decidedAt: string | null;
  hiredMemberId: string | null;
  notes: string;
  updatedAt: string;
  candidate?: Candidate;
  opening?: Opening;
  interviews?: Interview[];
  movement?: StageEvent[];
  offers?: Offer[];
  /** False when RLS refused the offers - a different fact from "no offer". */
  canSeeOffers?: boolean;
}

export interface StageEvent {
  id: number;
  fromStage: ApplicationStage | null;
  toStage: ApplicationStage;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  note: string;
  createdAt: string;
  member?: { id: string; profiles?: JoinedProfile } | null;
}

export interface Interview {
  id: string;
  applicationId: string;
  kind: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string;
  meetingUrl: string | null;
  status: string;
  calendarEventId: string | null;
  agenda: string;
  application?: Application;
  participants?: { id: string; isLead: boolean; member?: { id: string; profiles?: JoinedProfile } }[];
  feedback?: Feedback[];
}

export interface Feedback {
  id: string;
  interviewId: string;
  memberId: string;
  recommendation: HireRecommendation | null;
  rating: number | null;
  strengths: string;
  concerns: string;
  notes: string;
  submittedAt: string | null;
  member?: { id: string; profiles?: JoinedProfile };
}

export interface Offer {
  id: string;
  applicationId: string;
  status: OfferStatus;
  jobTitle: string;
  departmentId: string | null;
  managerId: string | null;
  employmentType: string;
  startOn: string | null;
  probationMonths: number | null;
  baseAmount: number | null;
  currency: string;
  payPeriod: PayPeriodId;
  notes: string;
  expiresOn: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  declineReason: string;
  application?: Application;
  department?: { id: string; name: string } | null;
  manager?: { id: string; profiles?: JoinedProfile } | null;
  approver?: { id: string; profiles?: JoinedProfile } | null;
}

/* -------------------------------------------------------------------------- */
/*  Journeys                                                                  */
/* -------------------------------------------------------------------------- */

export interface ChecklistItem {
  id: string;
  checklistId?: string;
  memberId?: string;
  title: string;
  description: string;
  category: ChecklistCategory;
  assigneeId: string | null;
  dueOn: string | null;
  isDone: boolean;
  completedAt: string | null;
  requiresDocument: boolean;
  documentFileId: string | null;
  todoId: string | null;
  sortOrder: number;
  assignee?: { id: string; profiles?: JoinedProfile } | null;
}

export interface Journey {
  id: string;
  memberId: string;
  kind: JourneyKind;
  name: string;
  anchorDate: string;
  templateId: string | null;
  status: 'active' | 'completed' | 'cancelled';
  completedAt: string | null;
  createdAt: string;
  member?: JoinedMember;
  items?: ChecklistItem[];
  progress?: { total: number; done: number; percent: number; overdue: number };
}

export interface ChecklistTemplate {
  id: string;
  kind: JourneyKind;
  name: string;
  description: string;
  departmentId: string | null;
  employmentType: string | null;
  isDefault: boolean;
  isActive: boolean;
  items?: TemplateItem[];
  department?: { id: string; name: string } | null;
}

export interface TemplateItem {
  id: string;
  templateId: string;
  title: string;
  description: string;
  category: ChecklistCategory;
  owner: string;
  dueOffsetDays: number;
  requiresDocument: boolean;
  sortOrder: number;
}

export interface StarterTemplateOption {
  key: string; kind: JourneyKind; name: string; description: string; itemCount: number;
}

export interface EmployeeExit {
  id: string;
  memberId: string;
  exitType: ExitType;
  notifiedOn: string;
  lastWorkingDay: string;
  reason: string;
  isRehirable: boolean | null;
  exitInterview: string;
  checklistId: string | null;
  accountClosedAt: string | null;
  createdAt: string;
  member?: JoinedMember & { status?: string; isActive?: boolean };
  checklist?: Journey | null;
  recorder?: { id: string; profiles?: JoinedProfile } | null;
}

/* -------------------------------------------------------------------------- */
/*  Payroll                                                                   */
/* -------------------------------------------------------------------------- */

/** What `describeRuleset()` says. Rendered beside every payroll figure. */
export interface RulesetVerdict { trustworthy: boolean; headline: string; detail: string }

export interface Ruleset {
  id: string;
  name: string;
  countryCode: string;
  currency: string;
  rules: { roundTo?: number; steps: RuleStepShape[] };
  isStatutoryComplete: boolean;
  statutoryNote: string;
  isActive: boolean;
  verdict?: RulesetVerdict;
}

export interface RuleStepShape {
  code: string;
  label: string;
  kind: 'earning' | 'deduction' | 'employer_cost';
  method: 'fixed' | 'percent' | 'bands';
  basis?: string;
  amount?: number;
  rate?: number;
  bands?: { upTo: number | null; rate: number }[];
  reliefs?: { kind: string; rate?: number; amount?: number; minimum?: number }[];
  annualise?: boolean;
  employmentTypes?: string[];
}

export interface StarterRulesetOption {
  key: string; name: string; countryCode: string; currency: string; note: string; stepCount: number;
}

export interface PayrollPeriod {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  rulesetId: string | null;
  currency: string;
  periodsPerYear: number;
  status: PayrollRunStatus;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerCost: number;
  employeeCount: number;
  approvedAt: string | null;
  paidAt: string | null;
  expenseId: string | null;
  notes: string;
  ruleset?: Ruleset | null;
  approver?: { id: string; profiles?: JoinedProfile } | null;
  verdict?: RulesetVerdict;
  items?: PayrollItem[];
}

export interface PayrollItem {
  id: string;
  periodId: string;
  memberId: string;
  baseAmount: number;
  gross: number;
  taxableGross: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
  currency: string;
  isHeld: boolean;
  holdReason: string;
  workings?: Record<string, any>;
  member?: JoinedMember & { employmentType?: string };
  lines?: PayrollLine[];
  period?: Pick<PayrollPeriod, 'id' | 'name' | 'periodStart' | 'periodEnd' | 'payDate' | 'status' | 'currency'>;
}

export interface PayrollLine {
  id: string;
  code: string;
  label: string;
  kind: 'earning' | 'deduction' | 'employer_cost';
  amount: number;
  source: string;
  explanation: string;
  sequence: number;
}

export interface CalculationResult {
  period: PayrollPeriod;
  calculated: number;
  excluded: { memberId: string; name: string; reason: string }[];
  verdict: RulesetVerdict;
}

/* -------------------------------------------------------------------------- */
/*  Cases                                                                     */
/* -------------------------------------------------------------------------- */

export interface HrCase {
  id: string;
  reference: string;
  category: HrCaseCategory;
  subject: string;
  description: string;
  raisedBy: string;
  memberId: string | null;
  assignedTo: string | null;
  priority: string;
  status: HrCaseStatus;
  isRestricted: boolean;
  resolution: string;
  resolvedAt: string | null;
  closedAt: string | null;
  firstResponseAt: string | null;
  createdAt: string;
  updatedAt: string;
  raiser?: { id: string; profiles?: JoinedProfile } | null;
  subjectMember?: JoinedMember | null;
  assignee?: { id: string; profiles?: JoinedProfile } | null;
  notes?: CaseNote[];
  events?: CaseEvent[];
  attachments?: { id: string; filename: string; mimeType: string | null; sizeBytes: number; createdAt: string }[];
  viewer?: { isHr: boolean; isRaiser: boolean; isAssignee: boolean };
}

export interface CaseNote {
  id: string;
  caseId: string;
  authorId: string | null;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author?: { id: string; profiles?: JoinedProfile } | null;
}

export interface CaseEvent {
  id: number;
  kind: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
  member?: { id: string; profiles?: JoinedProfile } | null;
}

/* -------------------------------------------------------------------------- */
/*  Module navigation                                                         */
/* -------------------------------------------------------------------------- */

export type Section =
  | 'home' | 'people' | 'org' | 'attendance' | 'leave'
  | 'performance' | 'recruitment' | 'journeys' | 'pay' | 'cases';
