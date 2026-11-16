import { z } from 'zod';
export const communicationPreferencesSchema = z.object({
  email: z.enum(['unknown', 'granted', 'withdrawn']),
  phone: z.enum(['unknown', 'granted', 'withdrawn']),
  doNotContact: z.boolean(),
  note: z.string().trim().max(2000),
}).strict();
export type CommunicationPreferences = z.infer<typeof communicationPreferencesSchema>;
export const defaultCommunicationPreferences: CommunicationPreferences = { email: 'unknown', phone: 'unknown', doNotContact: false, note: '' };
