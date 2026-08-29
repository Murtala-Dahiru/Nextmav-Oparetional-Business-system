import { authorize, pgError } from '@/lib/auth-context';
import { success, serverError } from '@/lib/api-response';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Deliver the reminders that have come due
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this exists when a scheduler already does the job ─────────────────
 *
 * Migration 0026 schedules `sweep_todo_reminders()` on `pg_cron` every minute,
 * which is the real delivery path and the reason a reminder arrives while
 * nobody has the application open. This endpoint is the same function called
 * by hand, and it exists for the environments where that extension is not
 * installed - a plain local Postgres, a restricted managed host, a project
 * where an administrator has not enabled it.
 *
 * Without it, the difference between "reminders work" and "reminders silently
 * never fire" would be invisible to anybody running the product outside the
 * one project this was built against. With it, the degradation is describable:
 * reminders arrive on next use rather than on the minute.
 *
 * ── Why it is safe to call this often, and from anyone ────────────────────
 *
 * The sweep claims rows by stamping `reminder_sent_at` in the same statement
 * that selects them, so the cron worker and any number of clients calling this
 * together cannot deliver the same reminder twice. Each notification is
 * addressed to the `member_id` on the to-do, so a sweep triggered by one
 * person cannot route another person's reminder anywhere it was not already
 * going - this endpoint chooses no recipients, it only makes the clock tick.
 *
 * Guarded on `mywork.view` all the same: a caller with no personal list has no
 * business making the product do work, and every internal role holds it.
 *
 * ── Why it reports what it did ────────────────────────────────────────────
 *
 * `delivered` is returned so the caller can decide whether to refresh its
 * notification tray, rather than refetching on a timer in the hope that
 * something arrived.
 */
export async function POST() {
  const ctx = await authorize('mywork', 'view');
  if (ctx instanceof Response) return ctx;

  try {
    const { data, error: e } = await ctx.supabase.rpc('sweep_todo_reminders', {
      limit_rows: 500,
    });

    if (e) {
      /**
       * A missing function is a deployment that has not run 0026 yet, and it
       * must not turn a page load into an error toast - the rest of My Work
       * works perfectly without reminders. Reported as zero delivered, with
       * the reason, so the caller can stop asking.
       */
      if (e.code === '42883' || e.code === 'PGRST202') {
        return success({ delivered: 0, available: false });
      }
      return pgError(e);
    }

    return success({ delivered: Number(data ?? 0), available: true });
  } catch (e: any) {
    return serverError(e, 'Could not check for reminders');
  }
}
