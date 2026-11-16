import { z } from 'zod';
import type { RequestContext } from '@/lib/auth-context';
import type { FieldDefinition } from '@/lib/crm/customization';
import { dealAmountSchema, dealCurrencySchema } from '@/lib/crm/currency';
import { mapImportFields } from '@/lib/crm/import-fields';
import type { PlannedRow, Plan } from './plan';

export async function planDealImport(ctx: RequestContext, rows: string[][], mapping: Record<string,number|undefined>, fields: FieldDefinition[]): Promise<Plan> {
  const existing = await ctx.supabase.from('deals').select('name', { count: 'exact' })
    .eq('organization_id',ctx.org.organizationId).is('deleted_at',null).order('id').limit(5000);
  if (existing.error) throw new Error('The duplicate check could not read deals.');
  const names = new Set(existing.data.map(d => String(d.name).trim().toLowerCase()));
  const planned = rows.map((row,index):PlannedRow => {
    const cell = (key:string) => mapping[key] === undefined ? '' : (row[mapping[key]!]?.trim() ?? '');
    const name = cell('dealName');
    const currency = cell('currency').toUpperCase() || ctx.org.currency;
    const value = Number(cell('value') || 0);
    const expectedClose = cell('expectedClose') || null;
    const problems: PlannedRow['candidate']['problems'] = [];
    if (!name || name.length > 250) problems.push({field:'dealName',severity:'error',message:'Enter a deal name of up to 250 characters'});
    if (!dealCurrencySchema.safeParse(currency).success || !dealAmountSchema.safeParse(value).success) problems.push({field:'value',severity:'error',message:'Check the currency and amount'});
    if (expectedClose && !z.iso.date().safeParse(expectedClose).success) problems.push({field:'expectedClose',severity:'error',message:'Use YYYY-MM-DD for expected close'});
    let customValues = {};
    try { customValues = mapImportFields(row,mapping,fields,true); }
    catch (cause) { problems.push({field:'customValues',severity:'error',message:(cause as Error).message}); }
    const duplicate = names.has(name.toLowerCase());
    if (duplicate) problems.push({field:'dealName',severity:'warning',message:'A deal with this name already exists or appears earlier in the file. Review before creating another.'});
    if (!problems.some(p=>p.severity==='error')) names.add(name.toLowerCase());
    return {row:index, candidate:{row:index,company:null,person:null,deal:{name,currency,value,expectedClose},customValues,problems},companyMatch:null,personMatch:null,companyFromRow:null,action:problems.length?'skip':'create',note:problems[0]?.message ?? 'New deal'};
  });
  const skipped=planned.filter(p=>p.action==='skip').length;
  return {rows:planned,summary:{total:rows.length,create:rows.length-skipped,skip:skipped,update:0,linked:0,companiesCreated:0,duplicates:planned.filter(p=>p.candidate.problems.some(i=>i.severity==='warning')).length,needsAttention:skipped,exhaustive:existing.count===existing.data.length}};
}
