import { z } from 'zod';

export const conversionSchema = z.object({
  createDeal: z.boolean().default(false),
  dealName: z.string().trim().max(250).optional(),
  dealValue: z.number().finite().min(0).max(999999999999.99).nullable().optional(),
  expectedClose: z.iso.date().nullable().optional(),
  contactId: z.uuid().nullable().optional(),
  companyId: z.uuid().nullable().optional(),
});
