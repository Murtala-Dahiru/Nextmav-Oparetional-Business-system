import {dealCurrencySchema,dealAmountSchema} from '@/lib/crm/currency';
import { collectionHandlers } from '@/lib/supabase/crud';
import { ownedScope } from '@/lib/supabase/crm-scope';
import { z } from 'zod';
import {pipelineFiltersSchema} from '@/lib/crm/pipeline-filters';
import {error} from '@/lib/api-response';

// The owner is resolved here as it is for leads. Without it the deal's
// owner column had nothing to render.
const SELECT =
  '*, company:companies(id, name), contact:contacts(id, first_name, last_name), ' +
  'owner:organization_members!deals_owner_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url))';

const handlers = collectionHandlers(
  {
    table: 'deals', module: 'crm', select: SELECT, softDelete: true,
    stableOrder:'id',
    enrich:async(rows,ctx,url)=>{
      if(url.searchParams.get('facts')!=='true'||!rows.length)return rows;
      const facts=await ctx.supabase.rpc('crm_deal_card_facts',{p_org:ctx.org.organizationId,p_ids:rows.map(r=>r.id)});
      if(facts.error)throw new Error('Could not load opportunity activity facts');
      const byId=new Map((facts.data??[]).map((f:{id:string})=>[f.id,f]));
      return rows.map(row=>({...row,...(byId.get(row.id) as object??{})}));
    },
    searchColumns: ['name', 'notes'],
    // `closed_at` is what the board's Won and Lost columns order by: the useful
    // Won column is the business just won, not the largest deal of all time.
    sortable: ['created_at', 'updated_at', 'name', 'value', 'stage', 'probability', 'expected_close', 'closed_at'],
    filterable: ['currency', 'stage', 'owner_id', 'company_id', 'pipeline_id', 'pipeline_stage_id', 'forecast_category'],
    // A role granted CRM at `scope: 'own'` sees its own records and no more.
    // See lib/supabase/crm-scope.ts for why this applies here and not to
    // companies or contacts.
    scope: (query,ctx,url)=>{
      let q=ownedScope(query,ctx);
      const teamMember=url.searchParams.get('teamMemberId');if(teamMember)q=q.contains('deal_team_ids',[teamMember]);
      if(url.searchParams.get('openOnly')==='true')q=q.not('stage','in','(closed_won,closed_lost)');
      for(const [key,op] of [['closeFrom','gte'],['closeTo','lte']] as const){
        const value=url.searchParams.get(key);
        if(value){if(!z.iso.date().safeParse(value).success)throw new Error('Invalid close date filter');q=q[op]('expected_close',value);}
      }
      for(const [key,op] of [['minValue','gte'],['maxValue','lte']] as const){
        const value=url.searchParams.get(key);
        if(value){if(!/^\d+(\.\d{1,2})?$/.test(value)||Number(value)>1e15)throw new Error('Invalid value filter');q=q[op]('value',Number(value));}
      }
      return q;
    },
  },
  {
    table: 'deals', module: 'crm', select: SELECT,
    prepare: (b, ctx) => {
      const currency=dealCurrencySchema.parse(b.currency??ctx.org.currency);
      if (!b.name?.trim()) throw new Error('Deal name is required');
      /**
       * `??` cannot supply this default.
       *
       * `Number(undefined)` is `NaN`, and `NaN` is neither null nor undefined,
       * so `Number(b.probability) ?? 20` evaluates to `NaN` - which survives
       * the clamp, is sent as null, and fails the NOT NULL constraint. Any
       * deal created without an explicit probability answered 500.
       */
      const parsed = Number(b.probability);
      const probability = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 20;
      const configured = z.object({
        pipeline_id:z.uuid().nullable().optional(),pipeline_stage_id:z.uuid().nullable().optional(),
        next_step:z.string().max(4000).optional(),forecast_category:z.enum(['pipeline','best_case','commit','omitted']).optional(),
        competitor:z.string().max(250).optional(),outcome_notes:z.string().max(12000).optional(),
        lost_reason:z.string().max(500).nullable().optional(),
      }).safeParse(b);
      if(!configured.success)throw new Error(configured.error.issues[0]?.message??'Invalid pipeline fields');
      return {
        ...configured.data,
        currency,
        name: b.name.trim(),
        company_id: b.company_id || null, contact_id: b.contact_id || null,
        stage: b.stage ?? 'prospecting',
        value: dealAmountSchema.parse(b.value===undefined?0:Number(b.value)),
        probability,
        expected_close: b.expected_close || null,
        notes: b.notes ?? '', owner_id: b.owner_id ?? ctx.org.memberId,
      custom_values: b.custom_values ?? {},
      };
    },
  },
);
export const POST=handlers.POST;
export async function GET(req:Request){
 const query=Object.fromEntries(new URL(req.url).searchParams);
 const parsed=pipelineFiltersSchema.safeParse(query);
 if(!parsed.success)return error(parsed.error.issues[0].message,422);
 for(const field of ['page','pageSize'])if(query[field]&&!z.coerce.number().int().positive().max(field==='page'?100000:100).safeParse(query[field]).success)return error('Invalid pagination',422);
 if(query.stage==='open'){const url=new URL(req.url);url.searchParams.delete('stage');url.searchParams.set('openOnly','true');return handlers.GET(new Request(url,req));}
 return handlers.GET(req);
}
