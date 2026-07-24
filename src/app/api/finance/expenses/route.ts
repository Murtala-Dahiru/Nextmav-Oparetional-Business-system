import { collectionHandlers } from '@/lib/supabase/crud';

const SELECT =
  '*, submitter:organization_members!expenses_submitted_by_fkey(id, profiles!organization_members_user_id_fkey(full_name, avatar_url)), approver:organization_members!expenses_approved_by_fkey(id, profiles!organization_members_user_id_fkey(full_name)), project:projects(id, name), department:departments(id, name)';

/**
 * Expenses.
 *
 * The exception within finance: anyone may submit and track their own claim,
 * but only finance roles see the organisation's full spend. That split is
 * enforced by RLS — the policy admits a row if you submitted it *or* you have
 * finance access — so this handler does not restate it.
 */
export const { GET, POST } = collectionHandlers(
  {
    table: 'expenses', module: 'hr', select: SELECT, softDelete: true,
    searchColumns: ['title', 'vendor', 'category', 'notes'],
    sortable: ['created_at', 'updated_at', 'title', 'amount', 'expense_date', 'status'],
    filterable: ['status', 'category', 'submitted_by', 'project_id', 'department_id'],
  },
  {
    table: 'expenses', module: 'hr', select: SELECT,
    prepare: (b, ctx) => {
      if (!b.title?.trim()) throw new Error('Title is required');
      const amount = Number(b.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error('Amount must be a positive number');
      }
      return {
        title: b.title.trim(),
        amount,
        currency: b.currency ?? 'USD',
        category: b.category ?? 'general',
        vendor: b.vendor ?? null,
        expense_date: b.expense_date ?? new Date().toISOString().slice(0, 10),
        // Always enters as pending: a claim that arrives pre-approved is a
        // self-authorisation. A trigger blocks approving your own regardless.
        status: 'pending',
        receipt_path: b.receipt_path ?? null,
        project_id: b.project_id || null,
        department_id: b.department_id || ctx.org.departmentId || null,
        submitted_by: ctx.org.memberId,
        notes: b.notes ?? '',
      };
    },
  },
);
