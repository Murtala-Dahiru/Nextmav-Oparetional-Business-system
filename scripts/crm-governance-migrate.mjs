import { readFileSync } from 'node:fs';
import { connect, readEnv } from './db-connect.mjs';
const { client } = await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'), { statement_timeout: 30000 });
try {
  await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='3s'");
  for (const file of ['0131_crm_governed_fields.sql', '0132_crm_field_layouts.sql', '0133_crm_directory_views.sql', '0134_crm_company_field_privacy.sql', '0135_crm_custom_stage_evidence.sql', '0136_crm_custom_automation_conditions.sql','0137_crm_department_visibility.sql','0138_crm_shared_views.sql','0139_crm_field_defaults.sql','0140_crm_field_references.sql','0141_crm_field_usage.sql','0142_crm_field_validation_rules.sql','0143_crm_list_preferences.sql','0144_crm_standard_detail_layouts.sql','0145_crm_personal_saved_views.sql','0146_crm_empty_field_types.sql','0147_crm_automation_field_snapshots.sql']) await client.query(readFileSync('supabase/migrations/' + file, 'utf8'));
  await client.query("NOTIFY pgrst, 'reload schema'");
  await client.query('COMMIT');
  console.log('Applied CRM governance migrations 0131–0147.');
} catch (e) { await client.query('ROLLBACK'); throw e; } finally { await client.end(); }
