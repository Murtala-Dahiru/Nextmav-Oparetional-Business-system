/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Shared PostgREST select expressions.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Each of these was declared in the collection route and nowhere else, so the
 *  matching `[id]` route fell back to `select: '*'` — columns only, no embedded
 *  relations. The list and the single record therefore returned different
 *  shapes for the same row.
 *
 *  That is not cosmetic. A component renders `project.owner.profiles.fullName`
 *  and `project.client.name` from the list; the update response has neither, so
 *  anything rendering the PUT result directly showed blanks until the next full
 *  refetch — and every module papered over it by refetching the whole list
 *  after every save, which is the duplicate-query pattern this pass is also
 *  removing.
 *
 *  Declaring them once means the two can no longer disagree. The strings are
 *  verbatim what the collection routes already used, so no response shape
 *  changes for the list; the record routes gain the relations they were
 *  missing.
 *
 *  The `!table_column_fkey` hints are required, not decorative: several tables
 *  reference `organization_members` more than once (an expense has a submitter
 *  *and* an approver), and PostgREST cannot choose between them unaided.
 */

/** A member with the profile fields the avatars and name labels need. */
const MEMBER = 'profiles!organization_members_user_id_fkey(full_name, avatar_url)';

export const SELECTS = {
  leads:
    `*, owner:organization_members!leads_owner_id_fkey(id, ${MEMBER})`,

  contacts: '*, company:companies(id, name)',

  companies: '*',

  deals:
    '*, company:companies(id, name), contact:contacts(id, first_name, last_name), ' +
    `owner:organization_members!deals_owner_id_fkey(id, ${MEMBER})`,

  projects:
    '*, department:departments(id, name), ' +
    `owner:organization_members!projects_owner_id_fkey(id, ${MEMBER}), ` +
    'client:companies(id, name)',

  tasks:
    '*, project:projects(id, name), ' +
    `assignee:organization_members!tasks_assignee_id_fkey(id, ${MEMBER})`,

  supportTickets:
    `*, assignee:organization_members!support_tickets_assignee_id_fkey(id, ${MEMBER}), ` +
    'contact:contacts(id, first_name, last_name)',

  invoices:
    '*, company:companies(id, name), contact:contacts(id, first_name, last_name), ' +
    'line_items:invoice_line_items(*)',

  expenses:
    `*, submitter:organization_members!expenses_submitted_by_fkey(id, ${MEMBER}), ` +
    'approver:organization_members!expenses_approved_by_fkey(id, profiles!organization_members_user_id_fkey(full_name)), ' +
    'project:projects(id, name), department:departments(id, name)',

  products:
    '*, warehouse:warehouses(id, name), supplier:suppliers(id, name, lead_time_days)',

  suppliers: '*',

  warehouses: '*',

  calendarEvents:
    `*, creator:organization_members!calendar_events_created_by_fkey(id, ${MEMBER})`,
} as const;
