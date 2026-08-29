import { collectionHandlers } from '@/lib/supabase/crud';
import { createCrmActivitySchema } from '@/lib/validations';
import { toSnake } from '@/lib/case';
import { todayIn, daysFromTodayIn } from '@/lib/org-time';

/**
 * The CRM timeline: calls, emails, meetings and notes.
 *
 * ── Why this route did not exist ──────────────────────────────────────────
 *
 * `crm_activities` has been in the schema since 0003, with RLS, two indexes
 * and a deliberate polymorphic design so that "everything that has happened
 * with this customer" is one ordered read rather than a UNION over four
 * tables. It had no endpoint, and the CRM's Activities tab was three hard-
 * coded rows in `useState` whose "Log activity" button appended to that array
 * and raised "Activity logged successfully".
 *
 * So the tab demonstrated the feature rather than providing it: every call a
 * salesperson recorded was gone on refresh, reported as saved. That is the
 * failure this codebase treats as the worst kind — a success message over a
 * discarded write.
 *
 * `member_id` is taken from the session rather than the body, for the same
 * reason the activity feed does it: who logged a call is part of the record,
 * and a client that can name someone else can forge it.
 */
/**
 * One expression for both handlers.
 *
 * The create route defaulting to `select: '*'` is a drift this codebase has
 * already paid for once: the row a POST returns comes back without the
 * embedded relations the list returns, so a newly logged call renders with no
 * author until the next refetch.
 */
const SELECT =
  '*, member:organization_members!crm_activities_member_id_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
  'company:companies(id, name), contact:contacts(id, first_name, last_name), ' +
  'lead:leads(id, first_name, last_name), deal:deals(id, name)';

/**
 * The four questions the timeline is actually asked.
 *
 * ── Why these are a scope hook and not four filters ───────────────────────
 *
 * `filterable` is equality on a column. "Overdue" is `due_at < today AND
 * completed_at IS NULL`, which is two predicates and a clock, and the clock
 * has to be the organisation's rather than UTC's - in Lagos, a follow-up due
 * today is overdue for the first hour of every day if you ask UTC.
 *
 *   ?due=overdue    owed before today, still open
 *   ?due=today      owed today, still open
 *   ?due=upcoming   owed after today, still open
 *   ?due=open       any open follow-up, in date order
 *   ?due=done       completed follow-ups, most recent first
 *   ?logged=true    activities that are history rather than follow-ups
 *   ?mine=true      only the caller's own
 *
 * Anything else is ignored rather than rejected, which is the behaviour every
 * other optional parameter on this factory has: an unrecognised filter must
 * never turn into an empty screen.
 */
function followUpScope(q: any, ctx: any, url: URL) {
  const zone = ctx.org.timezone;
  const today = todayIn(zone);

  if (url.searchParams.get('mine') === 'true') {
    q = q.eq('member_id', ctx.org.memberId);
  }

  if (url.searchParams.get('logged') === 'true') {
    // History: something that happened, rather than something owed.
    return q.is('due_at', null);
  }

  switch (url.searchParams.get('due')) {
    case 'overdue':
      return q.is('completed_at', null).not('due_at', 'is', null).lt('due_at', today);
    case 'today':
      return q.is('completed_at', null)
        .gte('due_at', today)
        .lt('due_at', daysFromTodayIn(zone, 1));
    case 'upcoming':
      return q.is('completed_at', null).gte('due_at', daysFromTodayIn(zone, 1));
    case 'open':
      return q.is('completed_at', null).not('due_at', 'is', null);
    case 'done':
      return q.not('completed_at', 'is', null);
    default:
      return q;
  }
}

export const { GET, POST } = collectionHandlers(
  {
    table: 'crm_activities',
    module: 'crm',
    select: SELECT,
    searchColumns: ['subject', 'body'],
    sortable: ['created_at', 'due_at', 'completed_at', 'activity_type'],
    filterable: ['activity_type', 'company_id', 'contact_id', 'lead_id', 'deal_id', 'member_id'],
    scope: followUpScope,
  },
  {
    table: 'crm_activities',
    module: 'crm',
    select: SELECT,
    prepare: (b, ctx) => {
      const parsed = createCrmActivitySchema.safeParse({
        activityType: b.activity_type ?? b.activityType,
        subject: b.subject,
        body: b.body,
        leadId: b.lead_id ?? b.leadId,
        contactId: b.contact_id ?? b.contactId,
        companyId: b.company_id ?? b.companyId,
        dealId: b.deal_id ?? b.dealId,
        dueAt: b.due_at ?? b.dueAt,
        completedAt: b.completed_at ?? b.completedAt,
        remindAt: b.remind_at ?? b.remindAt,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Invalid activity');
      }
      return { ...toSnake(parsed.data), member_id: ctx.org.memberId };
    },
  },
);
