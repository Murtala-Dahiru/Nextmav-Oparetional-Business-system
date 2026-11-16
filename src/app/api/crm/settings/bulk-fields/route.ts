import { z } from 'zod';
import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { crmObjectSchema, customValuesSchema } from '@/lib/crm/customization';

const input = z.object({
  object: crmObjectSchema,
  records: z.array(z.object({ id: z.uuid(), updatedAt: z.iso.datetime({ offset: true }) }).strict()).min(1).max(100),
  values: customValuesSchema.refine(values => Object.keys(values).length === 1, 'Choose one field'),
}).strict();

/** Independent optimistic updates preserve existing values and report partial failure. */
export async function POST(req: Request) {
  const ctx = await authorize('crm', 'edit');
  if (ctx instanceof Response) return ctx;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error('Choose one field and up to 100 current records.', 422);
  const { object, records, values } = parsed.data;
  if (new Set(records.map(r => r.id)).size !== records.length) return error('Duplicate record selection', 422);
  const metadata = await ctx.supabase.from('crm_field_definitions').select('id,archived')
    .eq('organization_id', ctx.org.organizationId).eq('object', object).eq('id', Object.keys(values)[0]).maybeSingle();
  if (metadata.error) return pgError(metadata.error);
  if (!metadata.data || metadata.data.archived) return error('Choose an active field for these records.', 422);
  const results: { id: string; updated: boolean; message?: string }[] = [];
  for (const record of records) {
    const current = await ctx.supabase.from(object)
      .select(object === 'companies' ? 'custom_values:crm_company_values' : 'custom_values')
      .eq('organization_id', ctx.org.organizationId).eq('id', record.id)
      .eq('updated_at', record.updatedAt).is('deleted_at', null).maybeSingle();
    if (current.error || !current.data) {
      results.push({ id: record.id, updated: false, message: 'Record changed or is unavailable. Reload before retrying.' });
      continue;
    }
    const prior = current.data as unknown as { custom_values: Record<string, unknown> | null };
    const update = await ctx.supabase.from(object).update({ custom_values: { ...prior.custom_values, ...values } })
      .eq('organization_id', ctx.org.organizationId).eq('id', record.id)
      .eq('updated_at', record.updatedAt).is('deleted_at', null).select('id').maybeSingle();
    results.push(update.error || !update.data
      ? { id: record.id, updated: false, message: 'Update rejected. Review permissions, field validation and the latest record.' }
      : { id: record.id, updated: true });
  }
  // Record triggers retain per-record change history; this entry describes the batch.
  const audit = await ctx.supabase.from('activity_log').insert({
    organization_id: ctx.org.organizationId, member_id: ctx.org.memberId, module: 'crm',
    action: 'update', title: 'Bulk custom field update', entity_type: object,
    metadata: { selected: records.length, updated: results.filter(r => r.updated).length, field: Object.keys(values)[0] },
  });
  if (audit.error) return pgError(audit.error);
  return success(results);
}
