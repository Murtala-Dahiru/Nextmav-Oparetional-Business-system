/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The People vocabulary.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every enum 0039-0043 introduced, once, with the words a person would use for
 * it. In `lib/` rather than inside the module because both halves read it: the
 * API routes validate against these lists and the screens render from them, and
 * a vocabulary that lives in a component is one the endpoint cannot check.
 *
 * The rule this file exists to enforce is the one the CRM broke twice: a raw
 * enum must never reach a screen. `notice_period` is not a status, it is a
 * database value, and the difference between the two is the entire reason
 * `statusLabel()` exists in `constants.ts` and is not enough on its own -
 * "Employee relations" is not `employee_relations` with an underscore removed,
 * and "PAYE" is not "Paye".
 */

// ─── Where somebody is in the employee journey ─────────────────────────────

export const EMPLOYMENT_STAGES = [
  'candidate', 'offer', 'onboarding', 'active',
  'on_leave', 'notice_period', 'offboarding', 'former',
] as const;
export type EmploymentStage = (typeof EMPLOYMENT_STAGES)[number];

/**
 * The stages a membership can actually be in.
 *
 * `candidate` and `offer` describe people who have no membership row - they
 * live in `candidates` and `job_applications` - so a People filter that
 * offered them would return nothing, for ever.
 */
export const MEMBER_STAGES: readonly EmploymentStage[] = [
  'onboarding', 'active', 'on_leave', 'notice_period', 'offboarding', 'former',
];

export const STAGE_LABELS: Record<EmploymentStage, string> = {
  candidate: 'Candidate',
  offer: 'Offer out',
  onboarding: 'Onboarding',
  active: 'Active',
  on_leave: 'On leave',
  notice_period: 'Serving notice',
  offboarding: 'Offboarding',
  former: 'Former employee',
};

/**
 * How a stage reads on screen.
 *
 * `tone` maps onto the readout severity vocabulary rather than a colour, so a
 * screen decides its own palette and the meaning stays here. Deliberately
 * quiet: only leaving is a warning, and nothing about a person is `bad`.
 */
export const STAGE_TONE: Record<EmploymentStage, 'accent' | 'quiet' | 'warn'> = {
  candidate: 'quiet',
  offer: 'accent',
  onboarding: 'accent',
  active: 'quiet',
  on_leave: 'quiet',
  notice_period: 'warn',
  offboarding: 'warn',
  former: 'quiet',
};

// ─── What happened to an employment ────────────────────────────────────────

export const EMPLOYMENT_EVENT_KINDS = [
  'hired', 'promoted', 'transferred', 'title_change', 'manager_change',
  'employment_type_change', 'stage_change', 'compensation_change',
  'offboarded', 'rehired', 'note',
] as const;
export type EmploymentEventKind = (typeof EMPLOYMENT_EVENT_KINDS)[number];

export const EVENT_LABELS: Record<EmploymentEventKind, string> = {
  hired: 'Joined',
  promoted: 'Promoted',
  transferred: 'Transferred',
  title_change: 'Title changed',
  manager_change: 'Manager changed',
  employment_type_change: 'Employment type changed',
  stage_change: 'Stage changed',
  compensation_change: 'Compensation reviewed',
  offboarded: 'Left',
  rehired: 'Rejoined',
  note: 'Note',
};

/** The kinds HR raises from the change dialogue, in the order it offers them. */
export const CHANGE_KINDS: readonly EmploymentEventKind[] = [
  'promoted', 'transferred', 'title_change', 'manager_change',
  'employment_type_change', 'note',
];

// ─── Employment types ──────────────────────────────────────────────────────

export const EMPLOYMENT_TYPES = [
  'full_time', 'part_time', 'contract', 'intern', 'temporary',
] as const;
export type EmploymentTypeId = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentTypeId, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  intern: 'Intern',
  temporary: 'Temporary',
};

// ─── Recruitment ───────────────────────────────────────────────────────────

export const OPENING_STATUSES = ['draft', 'open', 'on_hold', 'closed', 'filled'] as const;
export type OpeningStatus = (typeof OPENING_STATUSES)[number];

export const OPENING_STATUS_LABELS: Record<OpeningStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  on_hold: 'On hold',
  closed: 'Closed',
  filled: 'Filled',
};

export const APPLICATION_STAGES = [
  'applied', 'screening', 'interview', 'assessment', 'offer', 'hired',
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  assessment: 'Assessment',
  offer: 'Offer',
  hired: 'Hired',
};

export const APPLICATION_STATUSES = ['active', 'hired', 'rejected', 'withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const CANDIDATE_SOURCES = [
  'direct', 'referral', 'agency', 'careers_site', 'sourced', 'other',
] as const;

export const CANDIDATE_SOURCE_LABELS: Record<string, string> = {
  direct: 'Direct application',
  referral: 'Employee referral',
  agency: 'Agency',
  careers_site: 'Careers site',
  sourced: 'Sourced',
  other: 'Other',
};

export const WORK_MODES = ['onsite', 'hybrid', 'remote'] as const;
export const WORK_MODE_LABELS: Record<string, string> = {
  onsite: 'On site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

export const INTERVIEW_KINDS = [
  'screening', 'technical', 'panel', 'culture', 'final', 'other',
] as const;
export const INTERVIEW_KIND_LABELS: Record<string, string> = {
  screening: 'Screening call',
  technical: 'Technical',
  panel: 'Panel',
  culture: 'Team fit',
  final: 'Final',
  other: 'Interview',
};

export const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;

export const HIRE_RECOMMENDATIONS = ['strong_no', 'no', 'yes', 'strong_yes'] as const;
export type HireRecommendation = (typeof HIRE_RECOMMENDATIONS)[number];

/**
 * Four values with no middle, and the wording says why.
 *
 * A five-point scale with a neutral centre is where an interview panel goes to
 * avoid deciding, so the vocabulary asks the question a hiring meeting can use.
 */
export const RECOMMENDATION_LABELS: Record<HireRecommendation, string> = {
  strong_no: 'Strong no',
  no: 'No',
  yes: 'Yes',
  strong_yes: 'Strong yes',
};

export const OFFER_STATUSES = [
  'draft', 'approved', 'sent', 'accepted', 'declined', 'withdrawn', 'expired',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};

// ─── Journeys ──────────────────────────────────────────────────────────────

export const JOURNEY_KINDS = ['onboarding', 'offboarding'] as const;
export type JourneyKind = (typeof JOURNEY_KINDS)[number];

export const CHECKLIST_OWNERS = ['hr', 'manager', 'employee', 'it', 'finance'] as const;
export type ChecklistOwner = (typeof CHECKLIST_OWNERS)[number];

export const CHECKLIST_OWNER_LABELS: Record<ChecklistOwner, string> = {
  hr: 'HR',
  manager: 'Their manager',
  employee: 'The employee',
  it: 'IT',
  finance: 'Finance',
};

export const CHECKLIST_CATEGORIES = [
  'paperwork', 'equipment', 'access', 'training',
  'introductions', 'payroll', 'handover', 'return', 'other',
] as const;
export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number];

export const CHECKLIST_CATEGORY_LABELS: Record<ChecklistCategory, string> = {
  paperwork: 'Paperwork',
  equipment: 'Equipment',
  access: 'Access',
  training: 'Training',
  introductions: 'Introductions',
  payroll: 'Payroll',
  handover: 'Handover',
  return: 'Returns',
  other: 'Other',
};

export const EXIT_TYPES = [
  'resignation', 'dismissal', 'redundancy', 'retirement',
  'end_of_contract', 'mutual', 'other',
] as const;
export type ExitType = (typeof EXIT_TYPES)[number];

export const EXIT_TYPE_LABELS: Record<ExitType, string> = {
  resignation: 'Resignation',
  dismissal: 'Dismissal',
  redundancy: 'Redundancy',
  retirement: 'Retirement',
  end_of_contract: 'End of contract',
  mutual: 'Mutual agreement',
  other: 'Other',
};

// ─── Compensation and payroll ──────────────────────────────────────────────

export const PAY_PERIODS = ['annual', 'monthly', 'weekly', 'daily', 'hourly'] as const;
export type PayPeriodId = (typeof PAY_PERIODS)[number];

export const PAY_PERIOD_LABELS: Record<PayPeriodId, string> = {
  annual: 'per year',
  monthly: 'per month',
  weekly: 'per week',
  daily: 'per day',
  hourly: 'per hour',
};

export const COMP_CHANGE_REASONS = [
  'hire', 'promotion', 'merit', 'market_adjustment',
  'role_change', 'correction', 'demotion', 'other',
] as const;
export type CompChangeReason = (typeof COMP_CHANGE_REASONS)[number];

export const COMP_REASON_LABELS: Record<CompChangeReason, string> = {
  hire: 'Starting salary',
  promotion: 'Promotion',
  merit: 'Merit increase',
  market_adjustment: 'Market adjustment',
  role_change: 'Role change',
  correction: 'Correction',
  demotion: 'Reduction',
  other: 'Other',
};

export const PAY_COMPONENT_KINDS = ['earning', 'deduction', 'employer_cost'] as const;
export const PAY_COMPONENT_KIND_LABELS: Record<string, string> = {
  earning: 'Earning',
  deduction: 'Deduction',
  employer_cost: 'Employer cost',
};

export const PAYROLL_STATUSES = [
  'draft', 'calculated', 'approved', 'paid', 'cancelled',
] as const;
export type PayrollRunStatus = (typeof PAYROLL_STATUSES)[number];

export const PAYROLL_STATUS_LABELS: Record<PayrollRunStatus, string> = {
  draft: 'Draft',
  calculated: 'Calculated',
  approved: 'Approved',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

/**
 * Which statuses may follow which.
 *
 * The schema refuses a write to an approved run; this is the same rule stated
 * where the screen can read it, so a button that cannot work is not drawn.
 * It is a rendering aid and never an access decision - the database is.
 */
export const PAYROLL_NEXT: Record<PayrollRunStatus, readonly PayrollRunStatus[]> = {
  draft: ['calculated', 'cancelled'],
  calculated: ['approved', 'draft', 'cancelled'],
  approved: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

// ─── Cases ─────────────────────────────────────────────────────────────────

export const HR_CASE_CATEGORIES = [
  'request', 'inquiry', 'policy', 'payroll', 'benefits',
  'document_request', 'employee_relations', 'workplace_incident',
  'grievance', 'other',
] as const;
export type HrCaseCategory = (typeof HR_CASE_CATEGORIES)[number];

export const CASE_CATEGORY_LABELS: Record<HrCaseCategory, string> = {
  request: 'Employee request',
  inquiry: 'HR question',
  policy: 'Policy clarification',
  payroll: 'Pay and payroll',
  benefits: 'Benefits',
  document_request: 'Document request',
  employee_relations: 'Employee relations',
  workplace_incident: 'Workplace incident',
  grievance: 'Grievance',
  other: 'Other',
};

/**
 * Categories that default to restricted.
 *
 * A grievance and an employee-relations matter are about somebody, and the
 * somebody must not be able to read them. The dialogue still lets the person
 * change it - this only decides where the toggle starts, because a default
 * that has to be remembered is one that will be forgotten in the case where it
 * matters most.
 */
export const RESTRICTED_BY_DEFAULT: readonly HrCaseCategory[] = [
  'grievance', 'employee_relations', 'workplace_incident',
];

export const HR_CASE_STATUSES = [
  'open', 'in_progress', 'waiting_on_employee', 'resolved', 'closed',
] as const;
export type HrCaseStatus = (typeof HR_CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Record<HrCaseStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_on_employee: 'Waiting on employee',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const OPEN_CASE_STATUSES: readonly HrCaseStatus[] = [
  'open', 'in_progress', 'waiting_on_employee',
];

// ─── Documents ─────────────────────────────────────────────────────────────

export const HR_DOCUMENT_CATEGORIES = [
  'contract', 'offer_letter', 'policy', 'identification', 'certificate',
  'performance', 'onboarding', 'offboarding', 'payroll', 'case', 'other',
] as const;
export type HrDocumentCategory = (typeof HR_DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<HrDocumentCategory, string> = {
  contract: 'Contract',
  offer_letter: 'Offer letter',
  policy: 'Policy',
  identification: 'Identification',
  certificate: 'Certificate',
  performance: 'Performance',
  onboarding: 'Onboarding',
  offboarding: 'Offboarding',
  payroll: 'Payroll',
  case: 'Case attachment',
  other: 'Other',
};

/**
 * A policy is the company's, everything else is a person's.
 *
 * Which decides two things at once: whether the upload form asks for an
 * employee, and whether the file is written confidential. A contract with no
 * subject is unfileable; a policy with one is mis-filed.
 */
export const ORG_WIDE_DOCUMENTS: readonly HrDocumentCategory[] = ['policy'];

// ─── Small shared helpers ──────────────────────────────────────────────────

/** Look a label up, falling back to a readable version of the raw value. */
export function labelOf(
  map: Record<string, string>,
  value: string | null | undefined,
  fallback = '—',
): string {
  if (!value) return fallback;
  return map[value] ?? value.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

/**
 * Tenure as a person would say it.
 *
 * Months under a year, then years and months, then whole years past five -
 * because "6 years 2 months" is precision nobody asked for, while "8 months"
 * is exactly what a probation conversation needs.
 */
export function tenureLabel(months: number | null | undefined): string {
  if (months === null || months === undefined) return '—';
  if (months < 1) return 'New this month';
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years >= 5 || rest === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years}y ${rest}m`;
}
