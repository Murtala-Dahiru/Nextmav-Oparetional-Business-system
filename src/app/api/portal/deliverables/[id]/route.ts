import { authorize, pgError } from '@/lib/auth-context';
import { success, error } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A client's decision on a deliverable
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The second write the portal permits, after replying on a project.
 *
 * ── Why the portal needed this ────────────────────────────────────────────
 *
 * The portal could show a client what had been produced and gave them no way to
 * respond to it. Acceptance therefore happened in email, and the project record
 * never learned the outcome — so the team could not tell an unreviewed
 * deliverable from an approved one, and "waiting on the client" was a thing
 * people said in stand-up rather than a state the system held.
 *
 * It is also the missing input to project progress. `v_project_health` now
 * scores acceptance alongside plan and execution, which it can only do because
 * a decision is recorded here.
 *
 * ── What is enforced, and where ───────────────────────────────────────────
 *
 * Three separate layers, none of which relies on the others:
 *
 *   1. `files_client_decide` (0018) confines the UPDATE to rows that are
 *      deliverables, client-visible, not confidential, and on a project
 *      belonging to the caller's own company. That is the security boundary.
 *   2. This handler writes four columns and no others, so the row-level grant
 *      cannot be turned into a way to rename a file or move it between
 *      projects. A policy cannot express column-level restriction; the route is
 *      what does.
 *   3. `trg_notify_deliverable_decision` tells the project team, in the
 *      database, so the notification cannot be forgotten by a caller.
 *
 * ── Why staff can call it too ─────────────────────────────────────────────
 *
 * A decision often arrives by phone or in a meeting, and somebody has to record
 * it. An account manager marking a deliverable approved on the client's behalf
 * is a normal thing to do and the alternative is a spreadsheet. It is recorded
 * as *their* decision — `approved_by` is the caller's membership either way —
 * so the audit trail says who entered it rather than implying the client
 * clicked it themselves.
 */

type Params = { params: Promise<{ id: string }> };

const DECISIONS = ['approved', 'rejected'] as const;

const SELECT =
  'id, filename, project_id, requires_approval, approval_decision, approved_at, ' +
  'approval_note, ' +
  'approver:organization_members!files_approved_by_fkey(' +
  'id, profiles!organization_members_user_id_fkey(full_name))';

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await authorize('projects', 'view');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json());
    const decision = String(b.decision ?? '').trim();

    if (!DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
      return error(
        `A decision is ${DECISIONS.join(' or ')}, not "${decision}".`,
        422, 'VALIDATION_ERROR',
      );
    }

    const note = String(b.note ?? b.approval_note ?? '').trim().slice(0, 2000);

    /**
     * Rejection has to say why.
     *
     * A deliverable sent back with no reason is a round trip nobody can act on,
     * and the team's next question is always "what was wrong with it". Approval
     * needs no justification, so the requirement is one-sided.
     */
    if (decision === 'rejected' && !note) {
      return error(
        'Tell us what needs changing so the team can act on it.',
        422, 'REJECTION_NEEDS_REASON',
      );
    }

    /**
     * Resolve the file first, so a wrong id is a 404 rather than an RLS
     * rejection that reads as a server fault.
     *
     * The `requires_approval` check is here for the message, not the security:
     * a client cannot see a non-deliverable through the policy anyway, but a
     * staff member previewing the portal can, and "that file is not up for
     * approval" is a better answer than a silent no-op.
     */
    const { data: file, error: readError } = await ctx.supabase
      .from('files')
      .select('id, filename, project_id, requires_approval, is_client_visible, approval_decision')
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (readError) return pgError(readError);
    if (!file) return error('Not found', 404, 'NOT_FOUND');

    if (!file.requires_approval) {
      return error(
        'That file has not been put forward for approval.',
        409, 'NOT_A_DELIVERABLE',
      );
    }
    if (!file.is_client_visible) {
      return error(
        'That file is not shared with the client.',
        409, 'NOT_SHARED',
      );
    }

    const { data, error: e } = await ctx.supabase
      .from('files')
      .update({
        approval_decision: decision,
        // The server stamps when, not the client. Same reason a milestone's
        // completion date is server-assigned: a decision's date is evidence.
        approved_at: new Date().toISOString(),
        approved_by: ctx.org.memberId,
        approval_note: note,
      })
      .eq('organization_id', ctx.org.organizationId)
      .eq('id', id)
      .is('deleted_at', null)
      .select(SELECT)
      .maybeSingle();

    if (e) return pgError(e);
    if (!data) {
      // The row was readable and the update matched nothing, which means the
      // policy refused it — the caller is not this project's client.
      return error(
        'You are not permitted to decide on this deliverable.',
        403, 'RLS_DENIED',
      );
    }

    return success(data);
  } catch (e: any) {
    return error(e.message || 'Could not record the decision', 500);
  }
}

export { PATCH as PUT };
