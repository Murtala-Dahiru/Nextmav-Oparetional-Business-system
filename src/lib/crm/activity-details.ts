import { z } from 'zod';

export const activityDetailsSchema = z.object({
  priority: z.enum(['low', 'normal', 'high']).optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  duration: z.number().int().min(0).max(1440).optional(),
  outcome: z.string().max(500).optional(),
  participants: z.array(z.string().trim().email().max(254)).max(50).optional(),
  timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Choose a valid timezone').optional(),
  location: z.string().max(500).optional(),
  videoUrl: z.union([z.literal(''), z.url().refine(value => new URL(value).protocol === 'https:', 'Use an HTTPS meeting link')]).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(),
}).strict();
