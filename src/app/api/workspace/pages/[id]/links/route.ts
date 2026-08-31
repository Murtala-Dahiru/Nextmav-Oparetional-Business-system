import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { can } from '@/lib/permissions';
import {
  ENTITY_TYPES, OWNING_MODULE, RESOLVERS, decorateLinks, type EntityType,
} from '@/lib/workspace-links';

type Params = { params: Promise<{ id: string }> };

/**
 * ===========================================================================
 *  What a page is about.
 * ===========================================================================
 *
 *  A workspace page can name the business records it concerns: the customer,
 *  the deal, the project, the invoice. That is what makes the workspace part
 *  of the operating system rather than a document application that happens to
 *  be signed in.
 *
 *  -- The rule this endpoint exists to enforce ----------------------------
 *
 *  A route's module says who may call it, not what the caller may see inside
 *  it. This is guarded on `workspace`, because linking is an act of editing a
 *  page. But the *label* of a linked record comes from CRM, Projects, Finance,
 *  Support or HR, and a workspace grant is not a grant to read those.
 *
 *  `decorateLinks` resolves a label through the caller's own client, and only
 *  for modules the caller can open. Where it cannot, the label recorded at
 *  link time is returned and `readable` is false - so the panel says "a record
 *  you cannot open" rather than either leaking its current name or rendering a
 *  blank row.
 */

export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const { data, error: e } = await ctx.supabase
    .from('workspace_page_links').select('*')
    .eq('organization_id', ctx.org.organizationId)
    .eq('page_id', id)
    .order('created_at', { ascending: true });

  if (e) return pgError(e);
  return success(await decorateLinks(ctx as any, data ?? []));
}

/**
 * Link a record to this page.
 *
 * The caller must be able to see the record they are linking. The database
 * trigger only checks that it exists in the organisation, which is the tenant
 * boundary; this is the module boundary, and it is the one that stops a
 * document's link panel from being used to confirm that a deal called
 * "Acquisition of Halden" exists.
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  let b: Record<string, any>;
  try {
    b = acceptBody(await req.json());
  } catch {
    return error('Invalid request body', 422, 'VALIDATION_ERROR');
  }

  const entityType = String(b.entity_type ?? '') as EntityType;
  const entityId = String(b.entity_id ?? '').trim();

  if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) {
    return error(`"${b.entity_type}" is not something a page can be linked to.`, 422, 'VALIDATION_ERROR');
  }
  if (!entityId) return error('entityId is required', 422, 'VALIDATION_ERROR');

  const owner = OWNING_MODULE[entityType];
  if (owner && !can(ctx.org.role, owner, 'view')) {
    return error('You do not have access to that kind of record.', 403, 'MODULE_DENIED');
  }

  const spec = RESOLVERS[entityType];
  const key = entityType === 'employee' ? 'member_id' : 'id';
  let lookup = ctx.supabase
    .from(spec.table).select(spec.select)
    .eq('organization_id', ctx.org.organizationId)
    .eq(key, entityId);
  if (spec.softDelete) lookup = lookup.is('deleted_at', null);

  const { data: target } = await lookup.maybeSingle<any>();
  if (!target) return error('That record could not be found.', 404, 'NOT_FOUND');

  const { data, error: e } = await ctx.supabase
    .from('workspace_page_links')
    .insert({
      organization_id: ctx.org.organizationId,
      page_id: id,
      entity_type: entityType,
      entity_id: entityId,
      label: spec.label(target),
      created_by: ctx.org.memberId,
    })
    .select('*')
    .single();

  if (e) {
    if (e.code === '23505') return error('That record is already linked to this page.', 409, 'DUPLICATE');
    return pgError(e);
  }

  const [decorated] = await decorateLinks(ctx as any, [data]);
  return success(decorated, undefined, 201);
}

export async function DELETE(req: Request, { params }: Params) {
  const ctx = await authorize('workspace', 'edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  const linkId = new URL(req.url).searchParams.get('linkId');
  if (!linkId) return error('linkId is required', 422, 'VALIDATION_ERROR');

  const { data, error: e } = await ctx.supabase
    .from('workspace_page_links').delete()
    .eq('organization_id', ctx.org.organizationId)
    .eq('page_id', id)
    .eq('id', linkId)
    .select('id')
    .maybeSingle();

  if (e) return pgError(e);
  if (!data) return error('Not found', 404, 'NOT_FOUND');
  return success({ deleted: true });
}
