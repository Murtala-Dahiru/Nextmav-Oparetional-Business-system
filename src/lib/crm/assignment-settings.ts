import {z} from 'zod';
export const assignmentSettingsSchema=z.object({version:z.number().int().min(0),fallbackId:z.uuid().nullable(),rules:z.array(z.object({id:z.uuid(),enabled:z.boolean(),mode:z.enum(['round_robin','territory','industry','service_interest','account_owner','workload']),memberIds:z.array(z.uuid()).max(100),matches:z.array(z.string().trim().min(1).max(250)).max(100)}).strict()).max(30)}).strict().refine(s=>new Set(s.rules.map(r=>r.id)).size===s.rules.length,'Rule IDs must be unique');
export type AssignmentSettings=z.infer<typeof assignmentSettingsSchema>;
