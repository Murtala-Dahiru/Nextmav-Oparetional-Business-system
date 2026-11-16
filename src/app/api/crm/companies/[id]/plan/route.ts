import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { accountPlanSchema } from '@/lib/crm/account-plan';
import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Params) {
  const ctx = await authorize('crm', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return error('Invalid company',422);
  const company = await ctx.supabase.from('companies').select('id').eq('id',id).eq('organization_id',ctx.org.organizationId).is('deleted_at',null).maybeSingle();
  if (company.error) return pgError(company.error);
  if (!company.data) return error('Company not found',404);
  const plan = await ctx.supabase.from('crm_account_plans').select('*').eq('organization_id',ctx.org.organizationId).eq('company_id',id).maybeSingle();
  if (plan.error) return plan.error.code==='PGRST205' || plan.error.code==='42P01'
    ? error('Account planning requires the CRM account-plan migration.',503,'CRM_SCHEMA_REQUIRED') : pgError(plan.error);
  return success(plan.data);
}
export async function PUT(req: Request, { params }: Params) {
  const ctx = await authorize('crm','edit');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return error('Invalid company',422);
  let body: unknown;
  try { body = await req.json(); } catch { return error('Invalid JSON',422); }
  const parsed = accountPlanSchema.safeParse(body);
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid plan',422);
  try {
    const { version, ...plan } = parsed.data;
    const result = await ctx.supabase.rpc('crm_save_account_plan',{ p_org:ctx.org.organizationId,p_company:id,p_version:version,p_plan:plan });
    if (result.error?.code==='40001') return error('A colleague changed this plan. Reload before saving; your draft is still here.',409,'CRM_PLAN_CONFLICT');
    if (result.error?.code==='PGRST202') return error('Account planning requires the CRM account-plan migration.',503,'CRM_SCHEMA_REQUIRED');
    if (result.error) return pgError(result.error);
    return success(result.data);
  } catch (cause) { return serverError(cause,'Could not save the account plan.'); }
}
