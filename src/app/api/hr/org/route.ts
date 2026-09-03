import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';

/**
 * The shape of the organisation.
 *
 * Departments, teams and the reporting line, in one read, so the org chart is
 * drawn from the company's real records rather than from anything invented for
 * the picture. Three facts, three tables that have held them since 0001:
 * `departments.parent_id` is the department hierarchy,
 * `organization_members.manager_id` is who reports to whom, and `teams` is the
 * cross-department grouping that is deliberately not either of those.
 *
 * ── Why the tree is built in the browser ─────────────────────────────────
 *
 * A recursive CTE would return the same people with a depth column, and the
 * screen would still have to assemble the nodes. Sending the flat list means
 * one query plan, no recursion limit to tune, and a chart that can be
 * re-rooted - "show me Engineering from Ada down" - without asking the server
 * again. The database's job here is to decide *which* people, which it does
 * through `v_hr_people`'s RLS.
 *
 * ── What an employee sees ────────────────────────────────────────────────
 *
 * Themselves. That is `auth_visible_member_ids()` doing its job, and it means
 * the chart is honest rather than empty: a manager sees their department, HR
 * sees the company. A screen wanting a company-wide chart for everybody would
 * need a permission decision, not a different query, and nobody has made one.
 */
export async function GET() {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const org = ctx.org.organizationId;

  const [departments, people, teams] = await Promise.all([
    ctx.supabase.from('departments')
      .select('id, name, description, parent_id, head_id, cost_centre')
      .eq('organization_id', org).is('deleted_at', null)
      .order('name'),

    ctx.supabase.from('v_hr_people')
      .select('member_id, full_name, avatar_url, job_title, role, department_id, department_name, manager_id, lifecycle_stage, employment_type, presence')
      .eq('organization_id', org)
      .neq('lifecycle_stage', 'former')
      .order('full_name'),

    ctx.supabase.from('teams')
      .select('id, name, description, department_id, lead_id, members:team_members(member_id, role)')
      .eq('organization_id', org).is('deleted_at', null)
      .order('name'),
  ]);

  if (departments.error) return pgError(departments.error);
  if (people.error) return pgError(people.error);

  const roster = people.data ?? [];

  /**
   * Head count per department, counted here rather than by the screen.
   *
   * The chart draws the number beside the department name and the list beneath
   * it draws the people; computing the first from the second in two places is
   * how they come to disagree when one of them filters.
   */
  const counts = new Map<string, number>();
  for (const p of roster) {
    const key = p.department_id ?? 'unassigned';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return success({
    departments: (departments.data ?? []).map((d: any) => ({
      ...d,
      member_count: counts.get(d.id) ?? 0,
      head_name: roster.find((p: any) => p.member_id === d.head_id)?.full_name ?? null,
    })),
    unassigned_count: counts.get('unassigned') ?? 0,
    people: roster,
    /* Teams are optional structure; an organisation with none is normal, and a
       failed read here must not take the chart down with it. */
    teams: teams.error ? [] : (teams.data ?? []),
  });
}
