import { MODULES, type ModuleId } from '@/lib/constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Intake - how work from anywhere else reaches a person's own list
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The problem this names ────────────────────────────────────────────────
 *
 * A project task is assigned to you. A ticket is escalated to you. A deal has
 * gone quiet and somebody has to call. All three are work you owe, all three
 * live in a module built for a *team* to see, and none of them is a plan for
 * your afternoon. What people did instead - reliably, in every product that
 * has ever had this shape - was retype the title into their own list and let
 * the two drift.
 *
 * So the intake is one action, and what it creates is deliberately **not** a
 * copy of the record. It is a personal to-do that *points at* the record:
 *
 *     Prepare the Q4 proposal
 *     Projects · Q4 Campaign - Client Acquisition
 *
 * The task stays the source of truth. Ticking the personal item off does not
 * complete it, does not move a burndown and does not appear on anybody else's
 * screen - the same guarantee `todos` has carried since 0016, extended to four
 * more modules.
 *
 * ── Why the label travels with the row ────────────────────────────────────
 *
 * `source_label` is captured at the moment of intake rather than joined at
 * read time. There is no generic join across five tables, and - the reason
 * that actually decides it - a to-do has to outlive its source. `todos`
 * already says so: `linked_task_id` is `ON DELETE SET NULL` precisely because
 * removing somebody's private reminder as a side effect of a project change is
 * the surprise the table exists to avoid. A label that was true when you wrote
 * it down stays readable when the ticket is closed and the row is gone.
 *
 * ── Where this lives, and why not in the module ───────────────────────────
 *
 * `lib/`, because both halves read it: `components/shared/add-to-my-work.tsx`
 * writes a source and `components/modules/mywork/*` renders one. Putting the
 * vocabulary inside My Work would mean Projects importing from another
 * module's folder to describe itself.
 */

/** What a record has to say about itself to become a personal to-do. */
export interface WorkSource {
  /** The module that owns the record. Validated against `MODULES` server-side. */
  module: ModuleId;
  /** The kind of record: `task`, `ticket`, `deal`, `lead`, `message`. */
  type: string;
  id: string;
  /**
   * How the source reads on the personal list - "Q4 Campaign · Client
   * Acquisition", "Ticket #1043 · Acme Ltd". Optional: a source with nothing
   * worth naming is better with no label than with a filler one.
   */
  label?: string | null;
}

/**
 * The record kinds intake understands.
 *
 * A closed list, because each entry is a promise the row makes: that the chip
 * says a true word, and that clicking it opens something. Adding a kind means
 * checking the owning module can actually receive `openRecord(module, type,
 * id)` - several already can, and the ones that cannot simply render the chip
 * without a link rather than a control that does nothing.
 */
export const SOURCE_KINDS: Record<string, { noun: string; module: ModuleId; opens: boolean }> = {
  task:     { noun: 'Task',    module: 'projects',      opens: true },
  project:  { noun: 'Project', module: 'projects',      opens: true },
  ticket:   { noun: 'Ticket',  module: 'support',       opens: true },
  deal:     { noun: 'Deal',    module: 'crm',           opens: true },
  lead:     { noun: 'Lead',    module: 'crm',           opens: true },
  contact:  { noun: 'Contact', module: 'crm',           opens: true },
  company:  { noun: 'Company', module: 'crm',           opens: true },
  message:  { noun: 'Message', module: 'communication', opens: false },
  /**
   * An action agreed in a meeting.
   *
   * `opens: true` because Communication's focus handler already accepts
   * `openRecord('communication', 'meeting', id)` - it switches to the meetings
   * view and opens the room or the record. A `message` cannot claim the same,
   * because opening one needs its channel as well as its id and a focus
   * request carries only the id.
   */
  meeting:  { noun: 'Meeting', module: 'communication', opens: true },
  invoice:  { noun: 'Invoice', module: 'finance',       opens: true },
  expense:  { noun: 'Expense', module: 'finance',       opens: false },
  page:     { noun: 'Page',    module: 'workspace',     opens: true },
  event:    { noun: 'Event',   module: 'calendar',      opens: false },
};

/** How a module names itself on a personal to-do. */
export const SOURCE_MODULE_LABELS: Partial<Record<ModuleId, string>> = {
  projects: 'Projects',
  support: 'Support',
  crm: 'CRM',
  communication: 'Communication',
  finance: 'Finance',
  hr: 'HR',
  inventory: 'Inventory',
  calendar: 'Calendar',
  workspace: 'Workspace',
  portal: 'Client Portal',
  admin: 'Admin',
  dashboard: 'Overview',
  mywork: 'My Work',
};

/**
 * Whether a source can be opened where it lives.
 *
 * `openRecord(module, type, id)` is delivered by `useFocusRequest`, and only
 * the modules that call it can act on one. A chip that looks clickable and
 * does nothing is worse than a chip that is plainly a label, so the row asks
 * this before deciding which to draw.
 */
export function sourceOpens(type: string | null | undefined): boolean {
  if (!type) return false;
  return SOURCE_KINDS[type]?.opens ?? false;
}

export function sourceNoun(type: string | null | undefined): string {
  if (!type) return 'Record';
  return SOURCE_KINDS[type]?.noun ?? type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * The body `POST /api/todos` wants for an intake.
 *
 * Flat rather than nested, because `acceptBody` converts keys and not
 * structure - `{ source: { module } }` would arrive as `source.module` and the
 * route would have to reach into it, which is exactly the kind of special case
 * that gets forgotten the second time somebody adds a field.
 */
export function intakeBody(
  title: string,
  source: WorkSource,
  extra: { dueOn?: string | null; note?: string; listId?: string | null } = {},
): Record<string, unknown> {
  return {
    title,
    note: extra.note ?? '',
    dueOn: extra.dueOn ?? null,
    listId: extra.listId ?? null,
    sourceModule: source.module,
    sourceType: source.type,
    sourceId: source.id,
    sourceLabel: source.label ?? null,
    /**
     * A project task additionally sets the real foreign key, which is what
     * gives the row live status and the guard against converting it twice.
     * Migration 0026's CHECK requires the two to agree, so this is not an
     * optional nicety - a task intake that set only the source triple would be
     * accepted, and a task intake that set only `linked_task_id` would be
     * refused.
     */
    ...(source.module === 'projects' && source.type === 'task'
      ? { linkedTaskId: source.id }
      : {}),
  };
}

/* -------------------------------------------------------------------------- */
/*  Server-side                                                               */
/* -------------------------------------------------------------------------- */

/** The database shape of a source, or nothing. */
export interface SourceColumns {
  source_module: string;
  source_type: string;
  source_id: string;
  source_label: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a source off the wire, as the all-or-nothing it is written as.
 *
 * ── Why the module is checked and the type is only shaped ─────────────────
 *
 * `MODULES` is a genuinely closed set - it is the product's own list of
 * modules, and a value outside it would draw a chip naming a place that does
 * not exist. `source_type` is a slug the calling module chooses, and pinning
 * it to a list here would mean this file had to be edited before any module
 * could ever pin a new kind of record. So the type is constrained by shape
 * (short, lowercase, no punctuation to smuggle) rather than by membership,
 * and `SOURCE_KINDS` decides only how a known one is *worded*.
 *
 * Returns a message rather than throwing, as every other validation in this
 * codebase does.
 */
export function readSource(
  b: Record<string, unknown>,
): { value: SourceColumns | null } | { message: string } {
  const moduleId = b.source_module == null ? null : String(b.source_module);
  const type = b.source_type == null ? null : String(b.source_type);
  const id = b.source_id == null ? null : String(b.source_id);

  if (!moduleId && !type && !id) return { value: null };

  if (!moduleId || !type || !id) {
    return {
      message: 'A source needs all three of module, type and id, or none of them.',
    };
  }

  if (!MODULES.some(m => m.id === moduleId)) {
    return { message: `"${moduleId}" is not a module of this product.` };
  }

  if (!/^[a-z][a-z0-9_]{1,31}$/.test(type)) {
    return { message: `"${type}" is not a record kind.` };
  }

  if (!UUID.test(id)) {
    return { message: 'That source id is not a record id.' };
  }

  const rawLabel = b.source_label == null ? '' : String(b.source_label).trim();

  return {
    value: {
      source_module: moduleId,
      source_type: type,
      source_id: id,
      // Truncated rather than refused: a label is a convenience, and failing
      // an intake because a project has a long name would be absurd.
      source_label: rawLabel ? rawLabel.slice(0, 200) : null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  From the notification tray                                                */
/* -------------------------------------------------------------------------- */

/**
 * Work arriving as a notification, if it is work you can take.
 *
 * The chain the product is trying to complete is: something is assigned to
 * you, the bell counts it, you decide when you will do it, and it appears on
 * your own list without the assigned record changing hands. The tray is where
 * that decision naturally happens, because it is where you first hear about
 * the work.
 *
 * Deliberately narrow. Only *assignments* qualify: a task or a ticket that has
 * landed on you and that you now owe. A completion, a comment, a status change
 * or a resolution are things to read, not things to plan, and an "Add to My
 * Work" button on all of them would be the noise this feature has to avoid to
 * stay useful.
 *
 * The work's own name lives in `body` for both producers (the `title` carries
 * the event: "New task assigned", "Ticket TCK-4471 assigned to you"), so that
 * is what becomes the to-do. Returns null for everything else, and the tray
 * renders no action.
 */
const INTAKE_FROM_NOTIFICATION: Record<string, { module: ModuleId; type: string }> = {
  task_assigned: { module: 'projects', type: 'task' },
  ticket_assigned: { module: 'support', type: 'ticket' },
  ticket_escalated: { module: 'support', type: 'ticket' },
};

export function intakeFromNotification(n: {
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
}): { title: string; source: WorkSource } | null {
  const kind = INTAKE_FROM_NOTIFICATION[n.type];
  if (!kind || !n.entityId) return null;
  // The entity has to be the kind the type promised; a mismatch means a
  // producer changed and this map did not, and inventing a source from it
  // would put a chip on somebody's list pointing at the wrong record.
  if (n.entityType !== kind.type) return null;

  const title = (n.body || '').trim() || n.title.trim();
  if (!title) return null;

  return {
    title,
    source: { module: kind.module, type: kind.type, id: n.entityId, label: null },
  };
}
