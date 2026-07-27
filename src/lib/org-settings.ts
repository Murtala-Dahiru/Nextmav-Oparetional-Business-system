/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Organisation policy documents.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  `org_settings.value` is jsonb, so anything at all can be written into it.
 *  The readers are the leave form, the project form, the attendance rules and
 *  the notification triggers — none of which fail loudly on a bad value. They
 *  just behave oddly: a leave type that is not a member of the `leave_type`
 *  enum renders as an option in the request form and then produces Postgres
 *  22P02 when somebody picks it, several screens away from the setting that
 *  caused it.
 *
 *  This module is the single description of what each key may contain. The
 *  endpoint validates against it, the administration screen renders from it,
 *  and the modules that consume a policy read it through `settingsOf()` — so
 *  a default cannot drift between the three.
 *
 *  The defaults here mirror `public.default_org_settings()` in migration 0017,
 *  which is what seeds a new organisation and what backfilled the existing
 *  ones. Both are needed: the database's copy makes an organisation usable
 *  before anybody opens the settings screen, and this one covers a key added
 *  after a backfill has already run.
 */

import { LEAVE_TYPES } from '@/lib/constants';

// ─── Attendance ────────────────────────────────────────────────────────────

export interface AttendancePolicy {
  /** Whether anybody may clock in as working remotely. */
  allowRemote: boolean;
  /** Require an explanation when they do. */
  requireNoteRemote: boolean;
  /** Below this many worked minutes a day is reported as a half day. */
  halfDayMinutes: number;
  /** Mark a working day with no check-in as absent rather than blank. */
  autoAbsent: boolean;
  /** Worked minutes past which the rest of a shift counts as overtime. */
  overtimeAfterMinutes: number;
}

// ─── Leave ─────────────────────────────────────────────────────────────────

export interface LeavePolicy {
  /** Types offered on the request form. Must be members of the `leave_type` enum. */
  types: string[];
  requiresApproval: boolean;
  minNoticeDays: number;
  maxConsecutiveDays: number;
  allowHalfDay: boolean;
  carryOverDays: number;
}

// ─── Projects ──────────────────────────────────────────────────────────────

export interface ProjectTemplate {
  name: string;
  description: string;
  /** Phase names created with the project, in order. */
  milestones: string[];
}

export interface ProjectDefaults {
  statuses: string[];
  priorities: string[];
  taskCategories: string[];
  milestoneStages: string[];
  defaultStatus: string;
  defaultPriority: string;
  templates: ProjectTemplate[];
}

// ─── Notifications ─────────────────────────────────────────────────────────

/**
 * Which events produce a notification.
 *
 * Keyed by the `type` the database triggers actually pass to
 * `notify_members()`, which reads this before it writes anything — so
 * switching one off stops the row existing rather than filtering it on the way
 * out. A notification nobody wants should not cost a row and an index entry on
 * every task update in the organisation, forever.
 *
 * The keys are deliberately the emitted vocabulary rather than a prettier one
 * of their own: a label that corresponds to nothing the system emits is how a
 * toggle comes to control nothing.
 */
export interface NotificationEvents {
  project: boolean;
  task: boolean;
  milestone: boolean;
  leave: boolean;
  invoice: boolean;
  expense: boolean;
  ticket: boolean;
  comment: boolean;
  mention: boolean;
  message: boolean;
  announcement: boolean;
  channel: boolean;
}

/** Label and explanation for each toggle, in the order the screen shows them. */
export const NOTIFICATION_EVENT_LABELS: {
  key: keyof NotificationEvents; label: string; hint: string;
}[] = [
  { key: 'task', label: 'Task activity', hint: 'Assigned to you, completed, or blocked on your project.' },
  { key: 'project', label: 'Project changes', hint: 'A project you are on is created, finished or re-planned.' },
  { key: 'milestone', label: 'Milestones', hint: 'A delivery phase is completed, due, or has slipped.' },
  { key: 'leave', label: 'Leave requests', hint: 'Requests to approve, and decisions on your own.' },
  { key: 'invoice', label: 'Invoices', hint: 'Sent, paid, or gone overdue.' },
  { key: 'expense', label: 'Expense claims', hint: 'Submitted for your approval.' },
  { key: 'ticket', label: 'Support tickets', hint: 'Raised or reassigned to you.' },
  { key: 'comment', label: 'Comments', hint: 'Replies on work you are following.' },
  { key: 'mention', label: 'Mentions', hint: 'Someone names you in a message or comment.' },
  { key: 'message', label: 'Direct messages', hint: 'A colleague messages you privately.' },
  { key: 'channel', label: 'Channel invitations', hint: 'You are added to a channel.' },
  { key: 'announcement', label: 'Announcements', hint: 'Company-wide notices from administrators.' },
];

// ─── Branding ──────────────────────────────────────────────────────────────

export interface Branding {
  primaryColour: string;
  loginMessage: string;
  showLogoInSidebar: boolean;
}

// ───────────────────────────────────────────────────────────────────────────

export interface OrgSettings {
  attendancePolicy: AttendancePolicy;
  leavePolicy: LeavePolicy;
  projectDefaults: ProjectDefaults;
  notificationEvents: NotificationEvents;
  branding: Branding;
}

/**
 * The keys, as they are stored.
 *
 * Snake_case because that is the primary key in `org_settings`; the API
 * response is camelised on the way out like every other payload, so the
 * screens read `attendancePolicy` while the row says `attendance_policy`.
 */
export const SETTING_KEYS = [
  'attendance_policy',
  'leave_policy',
  'project_defaults',
  'notification_events',
  'branding',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const DEFAULT_SETTINGS: Record<SettingKey, Record<string, unknown>> = {
  attendance_policy: {
    allow_remote: true,
    require_note_remote: false,
    half_day_minutes: 240,
    auto_absent: true,
    overtime_after_minutes: 540,
  },
  leave_policy: {
    types: ['vacation', 'sick', 'personal', 'maternity', 'paternity', 'bereavement', 'unpaid'],
    requires_approval: true,
    min_notice_days: 0,
    max_consecutive_days: 30,
    allow_half_day: true,
    carry_over_days: 5,
  },
  project_defaults: {
    statuses: ['planning', 'active', 'on_hold', 'completed', 'cancelled', 'archived'],
    priorities: ['low', 'medium', 'high', 'critical'],
    task_categories: ['Feature', 'Bug', 'Improvement', 'Research', 'Documentation'],
    milestone_stages: ['planning', 'development', 'testing', 'review', 'deployment', 'completed'],
    default_status: 'planning',
    default_priority: 'medium',
    templates: [],
  },
  notification_events: {
    project: true,
    task: true,
    milestone: true,
    leave: true,
    invoice: true,
    expense: true,
    ticket: true,
    comment: true,
    mention: true,
    message: true,
    announcement: true,
    channel: true,
  },
  branding: {
    primary_colour: '#10b981',
    login_message: '',
    show_logo_in_sidebar: true,
  },
};

// ─── Validation ────────────────────────────────────────────────────────────

const PROJECT_STATUS_ENUM = [
  'planning', 'active', 'on_hold', 'completed', 'cancelled', 'archived',
];
const PRIORITY_ENUM = ['low', 'medium', 'high', 'critical'];
const STAGE_ENUM = [
  'planning', 'development', 'testing', 'review', 'deployment', 'completed',
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function badMembers(value: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(v => typeof v !== 'string' || !allowed.includes(v)).map(String);
}

/**
 * Check one policy document. Returns the message to send back, or null.
 *
 * Only the fields that can break something downstream are enforced. The rest
 * are free for an organisation to shape as it likes — a task category is a
 * label, and refusing an unfamiliar one would be the settings screen deciding
 * how somebody runs their projects.
 */
export function validateSetting(key: SettingKey, value: unknown): string | null {
  if (!isPlainObject(value)) return `${key} must be an object.`;

  if (key === 'leave_policy') {
    const types = value.types;
    if (types !== undefined) {
      if (!Array.isArray(types) || types.length === 0) {
        return 'Offer at least one leave type, or nobody can request leave.';
      }
      const bad = badMembers(types, LEAVE_TYPES);
      if (bad.length) {
        return `${bad.map(b => `"${b}"`).join(', ')} ${bad.length === 1 ? 'is not a' : 'are not'} leave type${bad.length === 1 ? '' : 's'} this system stores. Expected: ${LEAVE_TYPES.join(', ')}.`;
      }
    }
    for (const field of ['min_notice_days', 'max_consecutive_days', 'carry_over_days']) {
      if (field in value && (Number(value[field]) < 0 || !Number.isFinite(Number(value[field])))) {
        return `${field.replace(/_/g, ' ')} cannot be negative.`;
      }
    }
    if (Number(value.max_consecutive_days) === 0) {
      return 'The maximum consecutive days of leave has to be at least 1.';
    }
    return null;
  }

  if (key === 'project_defaults') {
    const checks: [string, readonly string[]][] = [
      ['statuses', PROJECT_STATUS_ENUM],
      ['priorities', PRIORITY_ENUM],
      ['milestone_stages', STAGE_ENUM],
    ];
    for (const [field, allowed] of checks) {
      if (value[field] === undefined) continue;
      if (!Array.isArray(value[field]) || (value[field] as unknown[]).length === 0) {
        return `Choose at least one ${field.replace(/_/g, ' ')}.`;
      }
      const bad = badMembers(value[field], allowed);
      if (bad.length) {
        return `${bad.map(b => `"${b}"`).join(', ')} cannot be used — the database only stores: ${allowed.join(', ')}.`;
      }
    }
    // A default the picker does not offer leaves the form with nothing
    // selected and every new project rejected by the check constraint.
    if (value.default_status && Array.isArray(value.statuses)
        && !(value.statuses as string[]).includes(String(value.default_status))) {
      return 'The default status has to be one of the statuses you allow.';
    }
    if (value.default_priority && Array.isArray(value.priorities)
        && !(value.priorities as string[]).includes(String(value.default_priority))) {
      return 'The default priority has to be one of the priorities you allow.';
    }
    if (value.templates !== undefined && !Array.isArray(value.templates)) {
      return 'Project templates must be a list.';
    }
    return null;
  }

  if (key === 'attendance_policy') {
    if ('half_day_minutes' in value) {
      const n = Number(value.half_day_minutes);
      if (!Number.isFinite(n) || n < 0 || n > 1440) {
        return 'The half-day threshold has to be between 0 and 1440 minutes.';
      }
    }
    if ('overtime_after_minutes' in value) {
      const n = Number(value.overtime_after_minutes);
      if (!Number.isFinite(n) || n < 0 || n > 1440) {
        return 'The overtime threshold has to be between 0 and 1440 minutes.';
      }
    }
    return null;
  }

  if (key === 'branding') {
    if (value.primary_colour !== undefined
        && !/^#[0-9a-fA-F]{6}$/.test(String(value.primary_colour))) {
      return 'The brand colour has to be a six-digit hex value, like #10b981.';
    }
    return null;
  }

  // notification_events: every field is a boolean toggle, and an unknown key
  // is simply an event nothing listens for yet.
  return null;
}

/**
 * Read a policy out of the camelised settings map an endpoint returned,
 * falling back to the default for anything absent.
 *
 * Used by the modules that consume a policy rather than edit it, so a missing
 * key produces the documented behaviour instead of `undefined` reaching a
 * comparison.
 */
export function settingsOf<T>(
  settings: Record<string, unknown> | null | undefined,
  key: SettingKey,
  camelDefaults: T,
): T {
  const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const stored = settings?.[camelKey];
  if (!isPlainObject(stored)) return camelDefaults;
  return { ...camelDefaults, ...stored } as T;
}
