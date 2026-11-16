import { z } from 'zod';
export const leadViewSchema = z.object({
  name: z.string().trim().min(1).max(60), search: z.string().max(250),
  filters: z.record(z.string(), z.string().max(12000)).refine(v => Object.keys(v).every(k => ['custom','status','source','ownerId','unassigned','campaign','active','unconverted','createdSince','awaitingResponse','overdueFollowUp'].includes(k)), 'Unsupported filter'),
  sort: z.enum(['createdAt','updatedAt','firstName','lastName','status','score','estimatedValue']).optional(),
  sortDir: z.enum(['asc','desc']).optional(),
}).strict();
export const leadViewsSchema = z.object({ version: z.number().int().min(0), views: z.array(leadViewSchema).max(20) });
export type LeadView = z.infer<typeof leadViewSchema>;
