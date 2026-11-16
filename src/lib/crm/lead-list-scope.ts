import type { RequestContext } from '@/lib/auth-context';
import { ownedScope } from '@/lib/supabase/crm-scope';

/** Inbox filters only narrow the caller's existing ownership boundary. */
export function leadListScope(query: any, context: RequestContext, url: URL) {
  let scoped = ownedScope(query, context);
  if (url.searchParams.get('awaitingResponse') === 'true') scoped = scoped.eq('awaiting_response', true);
  if (url.searchParams.get('overdueFollowUp') === 'true') scoped = scoped.eq('overdue_follow_up', true);
  if (url.searchParams.get('unassigned') === 'true') scoped = scoped.is('owner_id', null);
  if (url.searchParams.get('active') === 'true') scoped = scoped.is('converted_contact_id', null).not('status', 'in', '(won,lost)');
  if (url.searchParams.get('unconverted') === 'true') scoped = scoped.is('converted_contact_id', null);
  const since = url.searchParams.get('createdSince');
  if (since && Number.isFinite(Date.parse(since))) scoped = scoped.gte('created_at', new Date(since).toISOString());
  return scoped;
}
