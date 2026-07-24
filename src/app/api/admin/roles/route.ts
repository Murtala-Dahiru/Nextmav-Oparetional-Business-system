import { authorize, pgError } from '@/lib/auth-context';
import { success } from '@/lib/api-response';
import { ROLES, MODULES, type RoleId } from '@/lib/constants';
import { ROLE_GRANTS, allowedModules } from '@/lib/permissions';

/**
 * Roles and what each one can do.
 *
 * Roles are a fixed capability model in `lib/permissions.ts` and a matching
 * Postgres enum, not editable rows. That is deliberate: RLS policies are
 * written against specific role names, so a role invented at runtime would
 * have no policy and would silently see nothing — the worst kind of
 * permissions bug, because it looks like missing data rather than missing
 * access.
 *
 * The endpoint therefore describes the model and reports how many members hold
 * each role, which is what an administration screen actually needs. Assigning
 * a role to a person is done through /api/admin/users/[id].
 */
export async function GET() {
  const ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) return ctx;

  const { data: members, error: e } = await ctx.supabase
    .from('organization_members')
    .select('role, is_active')
    .eq('organization_id', ctx.org.organizationId);

  if (e) return pgError(e);

  const counts = (members ?? []).reduce<Record<string, number>>((acc, m: any) => {
    if (m.is_active) acc[m.role] = (acc[m.role] ?? 0) + 1;
    return acc;
  }, {});

  const roles = ROLES.map(r => {
    const id = r.id as RoleId;
    const grants = ROLE_GRANTS[id] ?? {};
    return {
      id,
      name: r.name,
      description: r.description,
      memberCount: counts[id] ?? 0,
      modules: allowedModules(id),
      // Flattened so the UI can render a capability matrix without
      // re-deriving the model and risking a different answer.
      permissions: MODULES.map(m => {
        const g = (grants as any)[m.id];
        return {
          module: m.id,
          label: m.label,
          allowed: !!g,
          actions: g ? [...g.actions] : [],
          scope: g?.scope ?? null,
        };
      }),
      // System roles cannot be deleted; every role here is one.
      isSystem: true,
    };
  });

  return success(roles, { total: roles.length } as any);
}
