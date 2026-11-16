import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { conversionSchema } from '@/lib/crm/conversion';
import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('crm', 'create');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return error('Invalid lead ID', 422, 'VALIDATION_ERROR');
  let body: unknown;
  try {
    const text = await req.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return error('Send a valid JSON request', 422, 'VALIDATION_ERROR');
  }
  const parsed = conversionSchema.safeParse(body);
  if (!parsed.success) return error(parsed.error.issues[0].message, 422, 'VALIDATION_ERROR');
  try {
    const input = parsed.data;
    const { data, error: failure } = await ctx.supabase.rpc('crm_convert_lead', {
      p_organization_id: ctx.org.organizationId,
      p_lead_id: id,
      p_create_deal: input.createDeal,
      p_deal_name: input.dealName || null,
      p_deal_value: input.dealValue ?? null,
      p_expected_close: input.expectedClose ?? null,
      p_contact_id: input.contactId ?? null,
      p_company_id: input.companyId ?? null,
    });
    if (failure) {
      if (failure.code === 'P0002') return error('Not found', 404, 'NOT_FOUND');
      if (failure.code === '22023') return error(failure.message, 422, 'VALIDATION_ERROR');
      if (failure.code === 'PGRST202') return error('Lead conversion is awaiting the CRM database update. Please contact your administrator.', 503, 'MIGRATION_REQUIRED');
      return pgError(failure);
    }
    if (data?.conflict) return error('Review the matching records before converting this lead.', 409, 'CONVERSION_CONFLICT', {
      contacts: data.contacts, companies: data.companies,
    });
    return success(data, { alreadyConverted: data.already_converted });
  } catch (cause) {
    return serverError(cause, 'That lead could not be converted.');
  }
}
