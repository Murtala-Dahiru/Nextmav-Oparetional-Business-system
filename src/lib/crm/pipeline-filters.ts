import {dealCurrencySchema} from './currency';
import {z} from 'zod';
const optionalId=z.union([z.uuid(),z.literal('')]).default('');
const optionalDate=z.union([z.iso.date(),z.literal('')]).default('');
const amount=z.string().max(24).refine(v=>v===''||(/^\d+(\.\d{1,2})?$/.test(v)&&Number(v)<=1e15),'Enter a non-negative amount').default('');
export const pipelineFiltersSchema=z.object({
 currency:z.union([dealCurrencySchema,z.literal('')]).default(''),
 forecastCategory:z.enum(['','pipeline','best_case','commit','omitted']).default(''),stage:z.enum(['','open','prospecting','qualification','proposal','negotiation','closed_won','closed_lost']).default(''),
 search:z.string().max(500).default(''),ownerId:optionalId,companyId:optionalId,teamMemberId:optionalId,pipelineStageId:optionalId,
 closeFrom:optionalDate,closeTo:optionalDate,minValue:amount,maxValue:amount,
}).superRefine((f,ctx)=>{
 if(f.closeFrom&&f.closeTo&&f.closeFrom>f.closeTo)ctx.addIssue({code:'custom',message:'Close date range is reversed'});
 if(f.minValue&&f.maxValue&&Number(f.minValue)>Number(f.maxValue))ctx.addIssue({code:'custom',message:'Value range is reversed'});
});
