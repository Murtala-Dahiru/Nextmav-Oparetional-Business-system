import { authorize } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { loadIndex, planRows } from '@/lib/import/plan';
import { MAX_ROWS } from '@/lib/import/sheet';
import type { Mapping } from '@/lib/import/records';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Step two: what would happen, said before it happens
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The rows come back from the browser with the mapping the user has settled
 *  on, and this answers: how many records, how many duplicates, what is wrong
 *  with which row, and what each row will do unless somebody changes it.
 *
 *  ── Why this is a second request rather than part of the first ───────────
 *
 *  The mapping changes. Somebody corrects "Sector" from Source to Industry and
 *  the whole answer moves - different fields populated, different duplicate
 *  matches, different validation. Re-uploading the file to see that would be
 *  absurd, and computing it in the browser would mean the duplicate check ran
 *  against whatever subset of the workspace the browser happened to have.
 *
 *  ── Why nothing is written ───────────────────────────────────────────────
 *
 *  Nothing. This route reads. `/commit` is the one that writes, and it re-runs
 *  exactly this planning first, so the confirmation screen and the import
 *  cannot describe different things.
 */

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const ctx = await authorize('crm', 'create');
  if (ctx instanceof Response) return ctx;

  try {
    const body = await req.json();
    const rows = body?.rows;
    const mapping = (body?.mapping ?? {}) as Mapping;
    const target = body?.target === 'contacts' ? 'contacts' : 'leads';

    if (!Array.isArray(rows) || !rows.length) {
      return error('There are no rows to preview.', 422, 'VALIDATION_ERROR');
    }
    if (rows.length > MAX_ROWS) {
      return error(`Only ${MAX_ROWS} rows can be imported at once.`, 422, 'VALIDATION_ERROR');
    }
    if (!Object.keys(mapping).length) {
      return error('Choose what at least one column means before previewing.', 422, 'VALIDATION_ERROR');
    }

    const { index, exhaustive } = await loadIndex(ctx);
    const plan = planRows(rows as string[][], mapping, index, exhaustive, target);

    return success(plan);
  } catch (e: any) {
    return serverError(e, 'That import could not be checked.');
  }
}
