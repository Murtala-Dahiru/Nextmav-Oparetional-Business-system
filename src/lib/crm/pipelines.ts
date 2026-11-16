import {z} from 'zod';

export const stageFields = ['company_id','contact_id','owner_id','expected_close','value','next_step','notes','lost_reason','competitor','outcome_notes','decision_maker','business_need','decision_process','close_plan'] as const;
export const canonicalStages = ['prospecting','qualification','proposal','negotiation','closed_won','closed_lost'] as const;
const evidenceField = z.union([z.enum(stageFields), z.templateLiteral(['custom:', z.uuid()])]);
export const pipelineStageSchema = z.object({
  id:z.uuid(), name:z.string().trim().min(1).max(100), canonicalStage:z.enum(canonicalStages),
  probability:z.number().int().min(0).max(100), inactivityDays:z.number().int().min(1).max(3650),
  entryGuidance:z.string().max(4000).default(''), exitGuidance:z.string().max(4000).default(''),
  requiredFields:z.array(evidenceField).max(100).default([]),
  exitRequiredFields:z.array(evidenceField).max(100).default([]),
  allowedNext:z.array(z.uuid()).max(40).default([]), ownerId:z.uuid().nullable().default(null),
  requiresApproval:z.boolean().default(false),
}).strict();
export const pipelineSchema = z.object({
  id:z.uuid().nullable(), version:z.number().int().min(0).max(2147483646),
  name:z.string().trim().min(1).max(100), purpose:z.enum(['new_business','enterprise','renewals','partnerships','expansion']),
  stages:z.array(pipelineStageSchema).min(2).max(40),
}).strict().superRefine((value,ctx)=>{
  const ids=new Set(value.stages.map(stage=>stage.id));
  if(ids.size!==value.stages.length) ctx.addIssue({code:'custom',message:'Stage IDs must be unique',path:['stages']});
  for(const [index,stage] of value.stages.entries()) if(stage.allowedNext.some(id=>!ids.has(id)))
    ctx.addIssue({code:'custom',message:'Transitions must stay in this pipeline',path:['stages',index,'allowedNext']});
  if(!value.stages.some(s=>!['closed_won','closed_lost'].includes(s.canonicalStage)))ctx.addIssue({code:'custom',message:'A pipeline needs at least one open stage',path:['stages']});
  for(const [index,stage] of value.stages.entries())if((stage.canonicalStage==='closed_won'&&stage.probability!==100)||(stage.canonicalStage==='closed_lost'&&stage.probability!==0))ctx.addIssue({code:'custom',message:'Won stages need 100% probability and lost stages need 0%',path:['stages',index,'probability']});
  for(const [index,stage] of value.stages.entries()) if(stage.requiredFields.includes('lost_reason')&&stage.canonicalStage!=='closed_lost')
    ctx.addIssue({code:'custom',message:'Loss reason can only be required in a lost stage',path:['stages',index,'requiredFields']});
  if((value.id===null)!==(value.version===0)) ctx.addIssue({code:'custom',message:'Reload the current pipeline revision',path:['version']});
});
export type PipelineInput=z.infer<typeof pipelineSchema>;
export type PipelineStageInput=z.infer<typeof pipelineStageSchema>;
