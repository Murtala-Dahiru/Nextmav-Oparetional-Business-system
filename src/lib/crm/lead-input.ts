import { customValuesSchema } from './customization';
import { z } from 'zod';
import { LEAD_STATUSES } from '@/lib/constants';
import { toUpdateSchema } from '@/lib/validations';

/** Shared API boundary for manual and authorized JSON intake. */
export const leadInputSchema = z.object({
  customValues: customValuesSchema.optional(),
  firstName: z.string().trim().max(150).optional().default(''),
  lastName: z.string().trim().max(150).optional().default(''),
  companyName: z.string().trim().max(250).optional().default(''),
  email: z.union([z.literal(''), z.string().trim().email().max(320)]).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  jobTitle: z.string().trim().max(250).nullable().optional(),
  source: z.string().trim().max(100).optional().default('manual'),
  campaign: z.string().trim().max(250).optional().default(''),
  status: z.enum(LEAD_STATUSES).optional().default('new'),
  score: z.number().int().min(0).max(100).optional().default(0),
  estimatedValue: z.number().finite().min(0).optional().default(0),
  notes: z.string().max(20000).optional().default(''),
  ownerId: z.uuid().nullable().optional(),
}).refine(v => Boolean(v.firstName || v.lastName || v.companyName), 'A lead needs a name or a company');

export const leadPatchSchema = toUpdateSchema(leadInputSchema);
