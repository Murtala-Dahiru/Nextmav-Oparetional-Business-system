import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { isFilterValue } from '@/lib/filters';
import { resolvePeriod } from '@/lib/performance';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The incentive ledger
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── Read only, deliberately ──────────────────────────────────────────────
 *
 *  There is no POST. An incentive somebody can type in is not a calculated
 *  one, and the whole value of this ledger is that every row traces to an
 *  event and a rule version. Entries are written by `apply_incentive_rules()`
 *  inside the transaction that recorded the event, and by nothing else.
 *
 *  Moving one along the chain is a PATCH on `[id]`, which is a status change
 *  and not an edit: the amount, the basis and the workings are immutable, and
 *  `guard_incentive_entry()` refuses in the database if a route ever forgets.
 *
 *  ── Who sees what ────────────────────────────────────────────────────────
 *
 *  Left entirely to `incentive_entries_select`: your own always, your
 *  people's if you manage them, everyone's if you are Finance and have to pay
 *  them. No application filter, because a second copy of that rule is a
 *  second thing to drift.
 */

const SELECT =
  'id, member_id, rule_id, rule_version, rule_name, source_event_id, '
  + 'basis_amount, currency, amount, status, explanation, reverses_entry_id, '
  + 'approved_at, paid_at, paid_reference, note, earned_at, created_at, '
  + 'member:organization_members!incentive_entries_member_id_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name, avatar_url, job_title)), '
  + 'approver:organization_members!incentive_entries_approved_by_fkey('
  + 'id, profiles!organization_members_user_id_fkey(full_name))';

export async function GET(request: Request) {
  const ctx = await authorize('performance', 'view');
  if (ctx instanceof Response) return ctx;

  const { supabase, org } = ctx;
  const url = new URL(request.url);

  const period = resolvePeriod(
    org.timezone,
    url.searchParams.get('from'),
    url.searchParams.get('to'),
  );

  let q = supabase
    .from('incentive_entries')
    .select(SELECT)
    .eq('organization_id', org.organizationId)
    .gte('earned_at', period.start)
    .lte('earned_at', `${period.end}T23:59:59.999Z`)
    .order('earned_at', { ascending: false })
    .limit(500);

  const status = url.searchParams.get('status');
  if (isFilterValue(status)) q = q.eq('status', status);

  const member = url.searchParams.get('member');
  if (isFilterValue(member)) q = q.eq('member_id', member);

  /**
   * `?mine=true` is how the personal screen asks, rather than passing its own
   * member id. The client should not have to know its membership identifier
   * to ask about itself, and a screen that does is a screen that shows
   * somebody else's ledger the first time that id is stale.
   */
  if (url.searchParams.get('mine') === 'true') {
    if (!org.memberId) return error('You have no membership in this organization.', 403);
    q = q.eq('member_id', org.memberId);
  }

  const { data, error: e } = await q;
  if (e) return pgError(e);

  const rows = data ?? [];

  /**
   * Totals by status, computed over the rows actually returned.
   *
   * Reversals carry a negative amount and their originals are marked
   * `reversed`, so a plain sum of everything is the net position and needs no
   * special case. That is the point of writing a mirror row rather than
   * editing the original.
   */
  const totals = rows.reduce(
    (acc: Record<string, number>, r: any) => {
      const amount = Number(r.amount ?? 0);
      acc[r.status] = (acc[r.status] ?? 0) + amount;
      acc.net += amount;
      return acc;
    },
    { pending: 0, approved: 0, paid: 0, rejected: 0, reversed: 0, net: 0 },
  );

  return success(rows, {
    period,
    currency: org.currency,
    totals,
    /* What this caller may do with them, so the screen need not guess. */
    mayApprove: ['owner', 'administrator', 'hr_staff', 'manager'].includes(org.role),
    mayPay: ['owner', 'administrator', 'finance_staff'].includes(org.role),
  });
}
