import { z } from 'zod';

export const commercialKinds = ['quote', 'proposal', 'contract', 'renewal'] as const;
export type CommercialKind = typeof commercialKinds[number];
const decimal = z.string().regex(/^\d{1,13}(\.\d{1,4})?$/, 'Use a positive decimal with at most four decimal places');
export const commercialContentSchema = z.object({
  items: z.array(z.object({ description: z.string().min(1).max(2000), quantity: decimal, unit: z.string().max(40), unitPrice: decimal, discountPercent: decimal, taxId: z.union([z.uuid(), z.literal('')]), productId: z.union([z.uuid(), z.literal('')]).optional() }).strict()).max(100),
  sections: z.array(z.object({ title: z.string().min(1).max(200), body: z.string().max(20000) }).strict()).max(40),
  discountPercent: decimal, charges: decimal, taxInclusive: z.boolean(),
  paymentTerms: z.string().max(8000), deliveryTerms: z.string().max(8000), notes: z.string().max(8000), internalNotes: z.string().max(8000),
  parties: z.string().max(8000), contractType: z.string().max(100), billingFrequency: z.string().max(100), terminationTerms: z.string().max(8000),
  renewalType: z.enum(['manual', 'automatic', 'non_renewing', 'unknown']), noticeDays: z.number().int().min(0).max(3650),
}).strict();
export type CommercialContent = z.infer<typeof commercialContentSchema>;
const optionalId = z.union([z.uuid(), z.literal('')]);
const date = z.union([z.iso.date(), z.literal('')]);
export const commercialSaveSchema = z.object({
  id: z.uuid().nullable(), revision: z.number().int().nonnegative(), kind: z.enum(commercialKinds), title: z.string().trim().min(1).max(200),
  companyId: z.uuid(), contactId: optionalId, dealId: optionalId, ownerId: optionalId, parentId: optionalId, quoteVersionId: optionalId,
  currency: z.string().regex(/^[A-Z]{3}$/), issueDate: date, expiresOn: date, effectiveOn: date, content: commercialContentSchema,
}).strict();
export const emptyCommercialContent = (): CommercialContent => ({ items: [], sections: [], discountPercent: '0', charges: '0', taxInclusive: false, paymentTerms: '', deliveryTerms: '', notes: '', internalNotes: '', parties: '', contractType: 'Service agreement', billingFrequency: '', terminationTerms: '', renewalType: 'unknown', noticeDays: 0 });
export const proposalTemplates: Record<string, string[]> = {
  'General business': ['Executive summary', 'Customer challenge', 'Proposed solution', 'Scope of work', 'Deliverables', 'Timeline', 'Milestones', 'Commercial investment', 'Assumptions', 'Exclusions', 'Terms', 'Next steps'],
  'IT consulting': ['Executive summary', 'Current environment', 'Assessment approach', 'Scope of work', 'Deliverables', 'Timeline', 'Commercial investment', 'Assumptions', 'Exclusions', 'Terms', 'Next steps'],
  'Software development': ['Executive summary', 'Customer challenge', 'Proposed solution', 'Technical scope', 'Deliverables', 'Milestones', 'Acceptance criteria', 'Commercial investment', 'Assumptions', 'Exclusions', 'Terms', 'Next steps'],
  'Creative services': ['Creative brief', 'Customer challenge', 'Creative direction', 'Deliverables', 'Review rounds', 'Timeline', 'Commercial investment', 'Usage rights', 'Exclusions', 'Next steps'],
  'Marketing services': ['Executive summary', 'Objectives', 'Audience', 'Proposed campaigns', 'Deliverables', 'Measurement plan', 'Timeline', 'Commercial investment', 'Assumptions', 'Exclusions', 'Next steps'],
  'Professional services': ['Executive summary', 'Customer challenge', 'Approach', 'Scope of work', 'Deliverables', 'Team', 'Timeline', 'Commercial investment', 'Assumptions', 'Exclusions', 'Terms', 'Next steps'],
};
export interface CommercialRecord {
 id: string; kind: CommercialKind; number: string; title: string; companyId: string; contactId: string | null; dealId: string | null; ownerId: string;
 parentId: string | null; quoteVersionId: string | null; currency: string; total: string | number; status: string; revision: number;
 issueDate: string; expiresOn: string | null; effectiveOn: string | null; updatedAt: string; createdAt: string;
 content: CommercialContent; pricing: Pricing; company?: {name:string}; approvedVersionId: string | null; issuedVersionId: string | null; executedVersionId: string | null;
}
export interface Pricing { currency: string; subtotal: string; discount: string; tax: string; charges: string; total: string; rounding: string; lines: (CommercialContent['items'][number] & { subtotal:string; total:string; tax:string; taxName:string; taxRate:string; discount:string })[] }
export const commercialLabel = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
