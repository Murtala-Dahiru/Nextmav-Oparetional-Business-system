import { readFileSync } from 'node:fs';
import { connect } from './db-connect.mjs';

// Default: validate pending CRM migrations, then roll back. --apply commits them.
// Never seeds records or invokes conversion against customer data.
const apply = process.argv.includes('--apply');
try { process.loadEnvFile('.env'); } catch {}
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error('Database connection is not configured');
const { client } = await connect(url, { statement_timeout: 15000 });
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='2s'");
  for (const file of ['0050_crm_conversion_and_access.sql', '0051_crm_account_summary.sql', '0052_crm_account_plans.sql', '0053_crm_lead_merge.sql', '0054_crm_configurable_pipelines.sql', '0055_crm_lead_qualification.sql', '0056_crm_assignment.sql', '0057_crm_capture.sql', '0058_crm_relationship_profiles.sql', '0059_crm_intelligence.sql', '0060_crm_relationship_timeline.sql', '0061_crm_files.sql', '0062_crm_merge_extensions.sql', '0063_crm_sales_targets.sql', '0064_crm_deal_execution.sql', '0065_crm_priority_completeness.sql', '0066_crm_pipeline_forecast.sql']) {
    await client.query(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    console.log(`Schema validation passed: ${file}`);
  }
  if (apply) {
    await client.query("NOTIFY pgrst, 'reload schema'");
    await client.query('COMMIT');
    console.log('Committed the CRM migrations and requested an API schema-cache reload.');
  } else {
    await client.query('ROLLBACK');
    console.log('Rolled back. No schema or business data changes committed.');
  }
} catch (cause) {
  await client.query('ROLLBACK');
  throw cause;
} finally { await client.end(); }
