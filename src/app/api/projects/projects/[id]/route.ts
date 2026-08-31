import { recordHandlers } from '@/lib/supabase/crud';
import { SELECTS } from '@/lib/supabase/selects';
import { updateProjectSchema } from '@/lib/validations';

/**
 * A single project.
 *
 * ── Why this route needed a schema and a select ────────────────────────────
 *
 * Editing a project was the reported defect, and it had two causes stacked on
 * one another.
 *
 * The failure came from `acceptBody`, which emitted both spellings of every
 * renamed field, so `clientCompanyId` arrived alongside `client_company_id` and
 * Postgres refused the write:
 *
 *     PGRST204  Could not find the 'clientCompanyId' column of 'projects'
 *
 * Creating a project was unaffected because its `prepare` names the columns it
 * wants and drops everything else. That is fixed in `lib/case`, and it was the
 * same fault on all thirteen of these routes.
 *
 * The second cause is that this route accepted *any* column. With the alias bug
 * gone, an unvalidated update is worse than a broken one: `deleted_at`,
 * `completed_at`, `organization_id` and `budget` were all writable by anyone
 * holding `projects.edit`, and none of the checks the create route applies were
 * applied here. `updateProjectSchema` - written months ago and until now
 * imported by nothing - is the list of fields a client may set, and the
 * `project_dates_valid` constraint catches an end date moved before the start
 * even when only one of the two is being changed.
 *
 * `SELECTS.projects` is the same expression the list uses, so the update
 * response carries the owner and client relations the card renders instead of
 * bare columns.
 */
export const { GET, PATCH, PUT, DELETE } = recordHandlers({
  table: 'projects',
  module: 'projects',
  select: SELECTS.projects,
  softDelete: true,
  updateSchema: updateProjectSchema,
});
