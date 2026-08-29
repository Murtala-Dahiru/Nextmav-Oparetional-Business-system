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
  ];

  for (const [label, sql] of steps) {
    const res = await client.query(sql, [ORG]);
    console.log(`  ${label.padEnd(12)} ${res.rowCount} removed`);
  }
} finally {
  await client.end();
}
