import { z } from 'zod';

export const planItemSchema = z.object({
  id: z.uuid(), kind: z.enum(['objective','action','stakeholder']), title: z.string().trim().min(1).max(250),
  description: z.string().max(4000), status: z.enum(['planned','in_progress','completed','blocked']),
  priority: z.enum(['low','normal','high']), progress: z.number().int().min(0).max(100),
  ownerId: z.uuid().nullable(), contactId: z.uuid().nullable(), dealId: z.uuid().nullable(),
  dueDate: z.iso.date().nullable(), role: z.string().max(250), influence: z.string().max(250),
}).strict();
export type PlanItem = z.infer<typeof planItemSchema>;
export const accountPlanSchema = z.object({
  items: z.array(planItemSchema).max(100).default([]),
  version: z.number().int().min(0).max(2147483646),
  objectives: z.string().max(12000),
  stakeholders: z.string().max(12000),
  opportunities: z.string().max(12000),
  risks: z.string().max(12000),
  actions: z.string().max(12000),
  ownerId: z.uuid().nullable(),
  reviewDate: z.iso.date().nullable(),
}).strict();
export type AccountPlanInput = z.infer<typeof accountPlanSchema>;
export type AccountPlan = AccountPlanInput & { updatedAt?: string; updatedBy?: string };
export const emptyAccountPlan: AccountPlanInput = {
  items: [], version: 0, objectives: '', stakeholders: '', opportunities: '', risks: '', actions: '', ownerId: null, reviewDate: null,
};
