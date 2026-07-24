import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT =
  '*, assignee:organization_members!support_tickets_assignee_id_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), contact:contacts(id, first_name, last_name)';

export const { GET, POST } = collectionHandlers(
  {
    table: 'support_tickets', module: 'support', select: SELECT, softDelete: true,
    searchColumns: ['subject', 'description', 'ticket_number', 'category'],
    sortable: ['created_at', 'updated_at', 'ticket_number', 'status', 'priority', 'due_at'],
    filterable: ['status', 'priority', 'assignee_id', 'category'],
  },
  {
    table: 'support_tickets', module: 'support', select: SELECT,
    prepare: (b, ctx) => {
      if (!b.subject?.trim()) throw new Error('Subject is required');
      return {
        subject: b.subject.trim(),
        description: b.description ?? '',
        status: b.status ?? 'open',
        priority: b.priority ?? 'medium',
        category: b.category ?? null,
        contact_id: b.contact_id || null,
        contact_email: b.contact_email || null,
        assignee_id: b.assignee_id || null,
        // Whoever raises it is the requester. That is what confines an external
        // client to seeing only their own tickets.
        requester_id: ctx.org.memberId,
        // ticket_number and the SLA due_at are assigned by trigger, so every
        // write path agrees on the numbering and on the promise being made.
      };
    },
  },
);
