/**
 * Remove what `scripts/hr-verify.mjs` cannot remove itself.
 *
 *     node scripts/hr-cleanup.mjs
 *
 * ── Why a harness that tidies up still leaves residue ─────────────────────
 *
 * Because three of the things it proves are *that the records are permanent*:
 *
 *   · an approved pay run refuses to be deleted - that is asserted, so the
 *     harness deleting one afterwards would contradict its own test;
 *   · `employment_events` has no UPDATE or DELETE policy at all, by design -
 *     the promotion the harness applies to a real demo employee is history;
 *   · a ruleset a run has used is `ON DELETE RESTRICT`, for the same reason
 *     `incentive_rules` is: it is the stated reason those payslips say what
 *     they say.
 *
 * All three are correct, and all three accumulate in a demo workspace whose
 * whole purpose is to be looked at - "Senior Something k3f9x (hrverify)" as
 * somebody's job title, five paid pay runs called "Verification run", and a
 * promotion timeline made of test fixtures.
 *
 * This is the service-role escape hatch for exactly that, and the same one
 * `crm-cleanup.mjs` exists to be. It is deliberately *not* an endpoint: the
 * product should not have a way to erase an employment record.
 *
 * It matches on the `hrverify` stamp and on nothing else, so it cannot touch a
 * real promotion, a real pay run or a real person's title.
 */
import { connect, readEnv } from './db-connect.mjs';

const ORG = process.env.HR_ORG ?? 'f90e4fc8-f408-47d3-b4d5-5e00f4133470';
const TAG = 'hrverify';

const { client } = await connect(readEnv('DATABASE_URL') || readEnv('DIRECT_URL'));

try {
  const steps = [
    /*
     * Cancel the fixture runs before touching their rows.
     *
     * `guard_frozen_payroll_rows()` refuses to delete an item belonging to an
     * approved or paid period, and it is a plain trigger rather than a policy -
     * so it holds against the service role too, which is exactly right and is
     * the first thing this script ran into. Cancelling is the one transition an
     * approved run does accept, and it takes the guard off the rows beneath it.
     */
    ['cancel runs', `
      UPDATE payroll_periods SET status = 'cancelled'
       WHERE organization_id = $1 AND name LIKE '%' || $2 || '%'
         AND status <> 'cancelled'`],

    /*
     * Then payroll, innermost first: a line cites its item, an item cites its
     * period, and the period cites the ruleset the last step removes.
     */
    ['payroll lines', `
      DELETE FROM payroll_lines l USING payroll_items i, payroll_periods p
       WHERE l.item_id = i.id AND i.period_id = p.id
         AND p.organization_id = $1 AND p.name LIKE '%' || $2 || '%'`],
    ['payroll items', `
      DELETE FROM payroll_items i USING payroll_periods p
       WHERE i.period_id = p.id
         AND p.organization_id = $1 AND p.name LIKE '%' || $2 || '%'`],
    ['payroll expenses', `
      DELETE FROM expenses e USING payroll_periods p
       WHERE p.expense_id = e.id
         AND p.organization_id = $1 AND p.name LIKE '%' || $2 || '%'`],
    ['pay runs', `
      DELETE FROM payroll_periods
       WHERE organization_id = $1 AND name LIKE '%' || $2 || '%'`],
    ['rulesets', `
      DELETE FROM payroll_rulesets
       WHERE organization_id = $1 AND name LIKE '%' || $2 || '%'`],

    /*
     * Compensation, and the employment events its trigger wrote. The event
     * carries no amount (0039), so what is being removed here is a dated note
     * saying pay was reviewed - and it is a fixture's note.
     */
    ['compensation', `
      DELETE FROM compensation_records
       WHERE organization_id = $1 AND note LIKE '%' || $2 || '%'`],

    /*
     * The employment history the harness wrote.
     *
     * Matched on the fixture's own wording - the titles it sets carry the
     * stamp, and its reasons are "Verification fixture" and "Exit withdrawn".
     * A real promotion has neither.
     */
    ['employment events', `
      DELETE FROM employment_events
       WHERE organization_id = $1
         AND (title_after LIKE '%' || $2 || '%'
              OR title_before LIKE '%' || $2 || '%'
              OR reason IN ('Verification fixture', 'Exit withdrawn')
              OR note LIKE '%' || $2 || '%')`],

    /*
     * And the title it left on a real demo employee. Reverting to NULL rather
     * than guessing: `v_hr_people` then falls back to `profiles.job_title`,
     * which is what the directory showed before the harness ran.
     */
    ['job titles', `
      UPDATE organization_members SET job_title = NULL
       WHERE organization_id = $1 AND job_title LIKE '%' || $2 || '%'`],

    ['checklist items', `
      DELETE FROM employee_checklist_items i USING employee_checklists c
       WHERE i.checklist_id = c.id
         AND c.organization_id = $1 AND c.name LIKE '%' || $2 || '%'`],
    ['checklists', `
      DELETE FROM employee_checklists
       WHERE organization_id = $1 AND name LIKE '%' || $2 || '%'`],
    ['orphaned to-dos', `
      DELETE FROM todos
       WHERE organization_id = $1
         AND source_module = 'hr'
         AND source_type IN ('onboarding_task', 'offboarding_task')
         AND NOT EXISTS (
           SELECT 1 FROM employee_checklist_items i WHERE i.id = todos.source_id
         )`],
    ['templates', `
      DELETE FROM checklist_templates
       WHERE organization_id = $1 AND name LIKE '%' || $2 || '%'`],

    ['cases', `
      DELETE FROM hr_cases
       WHERE organization_id = $1 AND subject LIKE '%' || $2 || '%'`],

    ['interviews', `
      DELETE FROM interviews i USING job_applications a, job_openings o
       WHERE i.application_id = a.id AND a.opening_id = o.id
         AND o.organization_id = $1 AND o.title LIKE '%' || $2 || '%'`],
    ['applications', `
      DELETE FROM job_applications a USING job_openings o
       WHERE a.opening_id = o.id
         AND o.organization_id = $1 AND o.title LIKE '%' || $2 || '%'`],
    ['openings', `
      DELETE FROM job_openings
       WHERE organization_id = $1 AND title LIKE '%' || $2 || '%'`],
    ['candidates', `
      DELETE FROM candidates
       WHERE organization_id = $1 AND full_name LIKE '%' || $2 || '%'`],

    /* The notifications the whole lot raised, which would otherwise leave the
       demo owner with a bell full of fixtures. */
    ['notifications', `
      DELETE FROM notifications
       WHERE organization_id = $1
         AND type IN ('employment_change', 'payslip_available', 'hr_case_assigned',
                      'hr_case_resolved', 'interview_scheduled', 'onboarding_complete')
         AND NOT EXISTS (
           SELECT 1 FROM hr_cases c WHERE c.id = notifications.entity_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM employment_events e WHERE e.id = notifications.entity_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM payroll_items i WHERE i.id = notifications.entity_id
         )`],
  ];

  console.log(`\n  HR verification residue in ${ORG}\n`);

  let total = 0;
  for (const [label, sql] of steps) {
    /* Two of these match on the tenant alone - an orphaned to-do and a
       notification have no name to stamp - and binding an unused parameter is
       a protocol error, not a no-op. */
    const params = sql.includes('$2') ? [ORG, TAG] : [ORG];
    const { rowCount } = await client.query(sql, params);
    total += rowCount;
    console.log(`    ${String(rowCount).padStart(4)}  ${label}`);
  }

  console.log(`\n  ${total} row(s) removed.\n`);
} finally {
  await client.end();
}
