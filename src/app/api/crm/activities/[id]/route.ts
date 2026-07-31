import { recordHandlers } from '@/lib/supabase/crud';
import { updateCrmActivitySchema } from '@/lib/validations';

/**
 * One logged activity.
 *
 * Hard delete: `crm_activities` has no `deleted_at`, and nothing references an
 * activity, so there is no foreign key to keep pointing at a tombstone. A note
 * logged against the wrong customer should genuinely go.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'crm_activities',
  module: 'crm',
  select:
    '*, member:organization_members!crm_activities_member_id_fkey(' +
    'id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), ' +
    'company:companies(id, name), contact:contacts(id, first_name, last_name), ' +
    'lead:leads(id, first_name, last_name), deal:deals(id, name)',
  updateSchema: updateCrmActivitySchema,
});
