import { scopeFor } from '@/lib/permissions';
import type { RequestContext } from '@/lib/auth-context';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Making `crm: { scope: 'own' }` mean something
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * `sales_staff` has held CRM at `scope: 'own'` since the capability model was
 * written. Nothing ever applied it. The list routes are built from
 * `collectionHandlers`, which scopes by tenant and offers a `scope` hook that
 * the CRM's five routes never passed - so an account manager granted "your own
 * records" saw every lead and every deal in the company, and the grant was a
 * comment rather than a rule.
 *
 * RLS could not catch it either: the policies in 0005 gate on
 * `can_access_module(organization_id, 'crm')`, which is a module question, not
 * an ownership one. Record-level scope in this product is an application
 * decision by design - the same decision `visibleModuleFilter` makes for the
 * activity feed.
 *
 * ── Why leads and deals, and not companies and contacts ───────────────────
 *
 * A lead and a deal are *assigned*: they have an owner, they are somebody's
 * work, and "yours" is a meaningful subset. A company and a contact are
 * reference data - the organisation's address book. Scoping those to their
 * `owner_id` would mean a salesperson could not attach their own deal to a
 * customer a colleague created, which is not a tighter security model, it is a
 * broken CRM. Both remain organisation-wide, and both are read-only-ish
 * anyway: nothing sensitive lives in a company row that a colleague may not
 * see.
 *
 * `crm_activities` is scoped by neither. The customer timeline is the record
 * of what the company has done with a customer, and half a timeline is worse
 * than none - a salesperson who cannot see that a colleague called yesterday
 * calls again.
 *
 * ── What a caller sees when it applies ────────────────────────────────────
 *
 * Fewer rows, and a screen that says so. `/api/crm/overview` returns the scope
 * it applied, and CRM Home writes "Your pipeline" rather than "Pipeline".
 * A figure that silently means something different for different people is the
 * failure this file exists to avoid twice over.
 */
export function ownedScope(q: any, ctx: RequestContext) {
  return scopeFor(ctx.org.role, 'crm') === 'own'
    ? q.eq('owner_id', ctx.org.memberId)
    : q;
}
