import { z } from 'zod';

export const categories = ['communication', 'projects', 'hr', 'crm', 'commercial', 'sign', 'finance', 'support', 'system'] as const;
export type Category = typeof categories[number];
export const preferencesSchema = z.object({
  push: z.boolean().default(false),
  messagePreviews: z.boolean().default(false),
  businessPreviews: z.boolean().default(false),
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
  if (entity === 'agreement' || type.startsWith('sign_')) return 'sign';
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

/** Minimal encrypted push text. Call only after current recipient access is checked.
 * Sensitive categories never carry record details to a lock screen. */
export function pushPresentation(row: { type: string; entity_type?: string; title?: string; body?: string }, prefs: NotificationPreferences) {
  const category = categoryOf(row.type, row.entity_type);
  const rich = category === 'communication' ? prefs.messagePreviews && row.entity_type === 'message'
    : prefs.businessPreviews && ['projects', 'crm', 'support'].includes(category);
  const safeTitles: Record<string, string> = {
    message_received: 'New message', message_mention: 'You were mentioned', message_reply: 'New reply',
    task_assigned: 'New task assigned', task_due: 'Task deadline approaching', task_overdue: 'Task overdue',
    leave_requested: 'Leave request awaiting review', leave_approved: 'Leave request approved', leave_rejected: 'Leave request rejected',
    lead_assigned: 'New lead assigned', ticket_assigned: 'New support ticket assigned',
    commercial_approved: 'Proposal approved', commercial_accepted: 'Proposal accepted', commercial_executed: 'Contract executed',
    commercial_pending_approval: 'Commercial approval requested', commercial_rejected: 'Commercial request rejected',
    deal_approval_pending: 'Deal approval requested', crm_followup_due: 'CRM follow-up due', crm_activity_assigned: 'CRM activity assigned',
    expense_approved: 'Expense approved', expense_rejected: 'Expense rejected',
    sign_sent: 'Document ready for signing', sign_deadline: 'Signing deadline approaching',
    sign_witness_signed: 'Witness signature received', hr_case_assigned: 'HR request assigned',
    ticket_deadline: 'Support deadline approaching', project_assigned: 'Project assignment',
    expense_submitted: 'Expense approval requested', access_changed: 'Workspace access changed',
    push_test: 'NextMav push test',
  };
  if (row.entity_type === 'agreement' && row.type === 'crm_automation') {
    const statusTitles: Record<string, string> = { 'Agreement completed': 'Contract fully signed', 'Agreement declined': 'Signing request declined', 'Agreement voided': 'Signing request voided' };
    if (statusTitles[row.title ?? '']) safeTitles[row.type] = statusTitles[row.title ?? ''];
  }
  return {
    title: rich ? plainPreview(row.title, 100) || safeTitles[row.type] || 'Workspace update'
      : safeTitles[row.type] || `${category[0].toUpperCase() + category.slice(1)} update`,
    body: row.type === 'push_test' ? 'This notification travelled through the server push pipeline.'
      : rich ? plainPreview(row.body, 240) || 'Open NextMav to view the details.' : 'Open NextMav to view the details.',
  };
}

export function plainPreview(value: string | undefined, limit: number): string {
  const text = (value || '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(text).length > limit ? Array.from(text).slice(0, limit - 1).join('') + '…' : text;
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
