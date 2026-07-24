import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { ROLES, MODULES, type RoleId } from '@/lib/constants';
import { ROLE_GRANTS, allowedModules } from '@/lib/permissions';

type Params = { params: Promise<{ id: string }> };

/** One role, with its capability matrix and the members who hold it. */
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('admin', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const definition = ROLES.find(r => r.id === id);
  if (!definition) return error('Not found', 404, 'NOT_FOUND');

  const roleId = id as RoleId;
  const grants = ROLE_GRANTS[roleId] ?? {};

  const { data: members, error: e } = await ctx.supabase
    .from('v_org_directory')
    .select('member_id, full_name, email, avatar_url, department_name')
    .eq('organization_id', ctx.org.organizationId)
    .eq('role', roleId)
    .eq('is_active', true);

  if (e) return pgError(e);

  return success({
    id: roleId,
    name: definition.name,
    description: definition.description,
    isSystem: true,
    modules: allowedModules(roleId),
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
    members: members ?? [],
    memberCount: (members ?? []).length,
  });
}

/**
 * Roles are not editable.
 *
 * RLS policies are written against these specific names, so a role whose
 * permissions could be redefined at runtime would drift out of step with the
 * database and grant access the policies do not — or, more often, silently
 * grant none. Changing what a role can do is a schema change, made in
 * `lib/permissions.ts` and the policies together.
 */
export async function PATCH() {
  return error(
    'Roles are part of the security model and cannot be edited at runtime. ' +
      'Assign a different role to the member instead.',
    405,
    'IMMUTABLE_ROLE',
  );
}

export async function DELETE() {
  return error(
    'System roles cannot be deleted.',
    405,
    'IMMUTABLE_ROLE',
  );
}
