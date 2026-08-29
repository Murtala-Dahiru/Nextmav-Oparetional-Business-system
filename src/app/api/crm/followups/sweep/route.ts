import { authorize, pgError } from '@/lib/auth-context';
import { success, serverError } from '@/lib/api-response';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Deliver the CRM follow-up reminders that have come due
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same shape, and the same reasoning, as
 * `/api/todos/reminders/sweep`: migration 0028 schedules
 * `sweep_crm_reminders()` on `pg_cron` every minute and that is the real
 * delivery path, but the extension is not installable everywhere. Without a
 * caller of last resort, the difference between "reminders work" and
 * "reminders silently never fire" would be invisible to anybody running the
 * product outside the project it was built against.
 *
 * Safe to call from anyone and as often as anyone likes: the sweep claims rows
 * by stamping `reminder_sent_at` in the same statement that selects them, so
 * the cron worker and every open tab together cannot deliver one reminder
 * twice, and every notification it writes is addressed to the `member_id`
 * already on the activity. This endpoint chooses no recipients; it only makes
 * the clock tick.
 *
 * Guarded on `crm.view`, because a follow-up is a CRM record and somebody with
 * no CRM has no business making the product do CRM work.
 */
export async function POST() {
  const ctx = await authorize('crm', 'view');
  if (ctx instanceof Response) return ctx;

  try {
    const { data, error: e } = await ctx.supabase.rpc('sweep_crm_reminders', {
      limit_rows: 500,
    });

    if (e) {
      // A missing function is a deployment that has not run 0028 yet. The rest
      // of CRM works perfectly without reminders, so this is reported as zero
      // delivered rather than turned into an error toast on a page load.
      if (e.code === '42883' || e.code === 'PGRST202') {
        return success({ delivered: 0, available: false });
      }
      return pgError(e);
    }

    return success({ delivered: Number(data ?? 0), available: true });
  } catch (e: any) {
    return serverError(e, 'Could not check for follow-up reminders');
  }
}
