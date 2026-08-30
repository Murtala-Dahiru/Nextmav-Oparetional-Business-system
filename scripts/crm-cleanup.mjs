/**
 * Remove the records `scripts/crm-verify.mjs` leaves behind in the demo
 * workspace when a run fails part-way through its own clean-up.
 *
 * The harness deletes what it created, but a run that was interrupted - or an
 * earlier version of it that created rows the clean-up did not know about -
 * leaves "Verify ..." leads, companies and timeline entries in a workspace
 * whose whole purpose is to be looked at.
 *
 *     node scripts/crm-cleanup.mjs
 */
import { connect, readEnv } from './db-connect.mjs';

const ORG = process.env.CRM_ORG ?? 'f90e4fc8-f408-47d3-b4d5-5e00f4133470';

const { client } = await connect(readEnv('DATABASE_URL') || readEnv('DIRECT_URL'));

try {
  const steps = [
    ['activities', `DELETE FROM crm_activities WHERE organization_id = $1
       AND (subject = 'Lead converted' OR subject LIKE 'Verification%'
            OR body LIKE 'Verify Person%')`],
    ['deals',      `DELETE FROM deals WHERE organization_id = $1 AND name LIKE 'Verif%'`],
    ['contacts',   `DELETE FROM contacts WHERE organization_id = $1 AND last_name LIKE 'Person%'`],
    ['leads',      `DELETE FROM leads WHERE organization_id = $1
       AND (last_name LIKE 'Person%' OR company_name LIKE 'Verify Holdings%'
            OR company_name LIKE 'Import %'
            OR (btrim(coalesce(first_name,'') || coalesce(last_name,'')) = ''
                AND coalesce(company_name,'') = ''))`],
    ['companies',  `DELETE FROM companies WHERE organization_id = $1
       AND (name LIKE 'Verify Holdings%' OR name LIKE 'Import Alpha%' OR name LIKE 'Import Beta%')`],

    /*
     * The Import Center is also driven through a real browser against a real
     * .xlsx, and that fixture names its companies with an epoch so two runs
     * never collide. The stamp is what makes these safe to match on: no real
     * customer is called "Rivergate Foods 1788038851907 Ltd".
     */
    ['drive leads',     `DELETE FROM leads WHERE organization_id = $1
       AND (company_name LIKE 'Rivergate Foods 1%' OR company_name LIKE 'Kestrel Analytics 1%'
            OR email LIKE '%@rivergate.test' OR email LIKE '%@kestrelanalytics.test')`],
    ['drive companies', `DELETE FROM companies WHERE organization_id = $1
       AND (name LIKE 'Rivergate Foods 1%' OR name LIKE 'Kestrel Analytics 1%')`],

    /*
     * What `performance-verify.mjs` cannot remove through the API.
     *
     * An incentive rule that has ever paid anybody is ON DELETE RESTRICT, and
     * deliberately so: deleting it would erase the reason a payment happened.
     * The suite therefore switches such rules off rather than removing them,
     * and the rows are cleared here, entries first because they hold the key.
     */
    ['incentive entries', `DELETE FROM incentive_entries WHERE organization_id = $1
       AND rule_id IN (SELECT id FROM incentive_rules
                       WHERE organization_id = $1 AND name LIKE 'VERIFY%')`],
    ['incentive rules',   `DELETE FROM incentive_rules WHERE organization_id = $1
       AND name LIKE 'VERIFY%'`],
    ['perf targets',      `DELETE FROM performance_targets WHERE organization_id = $1
       AND period_label = 'VERIFY'`],
    ['perf goals',        `DELETE FROM performance_goals WHERE organization_id = $1
       AND title LIKE 'VERIFY%'`],
    ['perf reviews',      `DELETE FROM performance_reviews WHERE organization_id = $1
       AND cycle_id IN (SELECT id FROM performance_cycles
                        WHERE organization_id = $1 AND name LIKE 'VERIFY%')`],
    ['perf cycles',       `DELETE FROM performance_cycles WHERE organization_id = $1
       AND name LIKE 'VERIFY%'`],
    /*
     * Titles carrying a 13-digit epoch, which is how every harness in this
     * repository names the records it creates. No real achievement is called
     * "Rescued the Corvo renewal 1788050064561".
     */
    ['perf achievements', `DELETE FROM performance_achievements WHERE organization_id = $1
       AND (title LIKE 'VERIFY%' OR title ~ '[0-9]{13}')`],
    ['partner leads',     `DELETE FROM partner_leads WHERE organization_id = $1
       AND (company_name LIKE 'Verify Partner Co%' OR last_name LIKE 'Prospect 1%')`],

    /*
     * Events whose record is gone, and the entries hanging off them.
     *
     * `business_events` deliberately holds no foreign key to `deals`: an
     * achievement outlives the record it came from, which is right for a
     * product that only ever soft-deletes. But a verification run creates a
     * deal, wins it, and then deletes it - and the event stays, so the demo
     * owner's performance fills with figures from deals nobody can open.
     *
     * Entries first: they reference the events.
     */
    ['orphan entries',    `DELETE FROM incentive_entries WHERE organization_id = $1
       AND source_event_id IN (
         SELECT e.id FROM business_events e
         LEFT JOIN deals d ON d.id = e.entity_id AND d.deleted_at IS NULL
         WHERE e.organization_id = $1 AND e.entity_type = 'deal' AND d.id IS NULL)`],
    ['orphan events',     `DELETE FROM business_events e WHERE e.organization_id = $1
       AND e.entity_type = 'deal'
       AND NOT EXISTS (SELECT 1 FROM deals d
                       WHERE d.id = e.entity_id AND d.deleted_at IS NULL)`],
    ['orphan lead events',`DELETE FROM business_events e WHERE e.organization_id = $1
       AND e.entity_type = 'lead'
       AND NOT EXISTS (SELECT 1 FROM leads l
                       WHERE l.id = e.entity_id AND l.deleted_at IS NULL)`],
  ];

  for (const [label, sql] of steps) {
    const res = await client.query(sql, [ORG]);
    console.log(`  ${label.padEnd(12)} ${res.rowCount} removed`);
  }
} finally {
  await client.end();
}
