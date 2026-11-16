import { z } from 'zod';

export const categories = ['communication', 'projects', 'hr', 'crm', 'commercial', 'sign', 'finance', 'support', 'system'] as const;
export type Category = typeof categories[number];
export const preferencesSchema = z.object({
  push: z.boolean().default(false),
  categories: z.record(z.enum(categories), z.boolean()).default(Object.fromEntries(categories.map(c => [c, true])) as Record<Category, boolean>),
  inAppCategories: z.record(z.enum(categories), z.boolean()).default(Object.fromEntries(categories.map(c => [c, true])) as Record<Category, boolean>),
  quietStart: z.number().int().min(0).max(23).default(22),
  quietEnd: z.number().int().min(0).max(23).default(7),
  quietEnabled: z.boolean().default(false),
  reminderMinutes: z.union([z.literal(0), z.literal(15), z.literal(60), z.literal(1440)]).default(60),
  silent: z.boolean().default(true),
  timezone: z.string().max(80).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }).default('UTC'),
});
export type NotificationPreferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences = preferencesSchema.parse({});

/** Registry describes existing business event families; producers remain transactional SQL. */
export const eventRegistry = {
  message_received: { category: 'communication', priority: 'normal' },
  message_mention: { category: 'communication', priority: 'high' },
  task_assigned: { category: 'projects', priority: 'normal' },
  task_due: { category: 'projects', priority: 'normal' },
  task_overdue: { category: 'projects', priority: 'high' },
  leave_requested: { category: 'hr', priority: 'normal' },
  leave_approved: { category: 'hr', priority: 'normal' },
  lead_assigned: { category: 'crm', priority: 'normal' },
  commercial_pending_approval: { category: 'commercial', priority: 'high' },
  ticket_assigned: { category: 'support', priority: 'normal' },
  expense_submitted: { category: 'finance', priority: 'normal' },
  push_test: { category: 'system', priority: 'normal' },
} as const;

export interface NotificationEvent {
  eventId: string; type: string; organizationId: string; actorId?: string;
  recipientIds: string[]; category: Category; recordId?: string; timestamp: string;
  title: string; safePreview: string; priority: 'low' | 'normal' | 'high' | 'critical';
  destination: string; channels: ('in_app' | 'push')[]; dedupeKey: string;
  expiresAt?: string; metadata?: Record<string, string | number | boolean>;
}

/** Build the dispatch contract from a trusted, committed notification row. */
export function eventFromRow(row: {
  event_id: string; id: string | number; type: string; organization_id: string;
  actor_id?: string; recipient_id: string; entity_type?: string; entity_id?: string;
  created_at: string | Date; link?: string; dedupe_key?: string; expires_at?: string | Date;
  priority?: string; in_app: boolean;
}): NotificationEvent {
  return {
    eventId: row.event_id, type: row.type, organizationId: row.organization_id, actorId: row.actor_id,
    recipientIds: [row.recipient_id], category: categoryOf(row.type, row.entity_type), recordId: row.entity_id,
    timestamp: new Date(row.created_at).toISOString(), title: 'NextMav',
    safePreview: 'You have a new notification in your workspace.',
    priority: row.type === 'access_changed' ? 'critical' : row.priority === 'high' ? 'high' : 'normal',
    destination: safeDestination(row.link), channels: row.in_app ? ['in_app', 'push'] : ['push'],
    dedupeKey: row.dedupe_key || row.event_id, expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
    metadata: { notificationId: String(row.id) },
  };
}

export function categoryOf(type: string, entity?: string | null): Category {
  if (entity === 'agreement') return 'sign';
  if (type in eventRegistry) return eventRegistry[type as keyof typeof eventRegistry].category;
  const prefix = type.split('_')[0];
  if (['message', 'mention', 'channel', 'meeting'].includes(prefix)) return 'communication';
  if (['task', 'project', 'milestone', 'deliverable'].includes(prefix)) return 'projects';
  if (['leave', 'hr', 'employee', 'attendance', 'review', 'payslip'].includes(prefix)) return 'hr';
  if (['lead', 'deal', 'crm'].includes(prefix)) return 'crm';
  if (['expense', 'invoice', 'payment'].includes(prefix)) return 'finance';
  if (['ticket', 'support'].includes(prefix)) return 'support';
  if (prefix === 'commercial') return 'commercial';
  return 'system';
}

export function isQuiet(now: Date, prefs: NotificationPreferences): boolean {
  if (!prefs.quietEnabled || prefs.quietStart === prefs.quietEnd) return false;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: prefs.timezone }).format(now));
  return prefs.quietStart < prefs.quietEnd ? hour >= prefs.quietStart && hour < prefs.quietEnd : hour >= prefs.quietStart || hour < prefs.quietEnd;
}

export function retryDelay(attempt: number, random = Math.random()): number {
  return Math.min(3600, 15 * 2 ** Math.max(0, attempt - 1)) + Math.floor(random * 10);
}
export function permanentFailure(status: number): boolean { return [400, 401, 403, 404, 410, 413].includes(status); }

export function safeDestination(value: string | null | undefined): string {
  if (!value || !value.startsWith('/dashboard') || value.startsWith('//')) return '/dashboard';
  const url = new URL(value, 'https://nextmav.invalid');
  if (url.origin !== 'https://nextmav.invalid' || url.pathname !== '/dashboard') return '/dashboard';
  const allowed = new Set(['module', 'tab', 'case', 'task', 'project', 'ticket', 'invoice', 'expense', 'event', 'page', 'deal', 'lead', 'contact', 'company', 'channel', 'commercial', 'agreement']);
  for (const key of [...url.searchParams.keys()]) if (!allowed.has(key)) url.searchParams.delete(key);
  return url.pathname + url.search;
}
