import { money, daysUntil } from './data';
import { personName } from './ui';
import type { CrmAttentionItem, CrmOverview } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  What needs a salesperson, assembled from what the CRM already knows
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Three rules, the same three the Executive Overview's queue follows ────
 *
 *  1. **One row per concern, not per record.** "Four follow-ups are overdue"
 *     is a decision; four rows of follow-ups is the Activities screen. Where
 *     exactly one record is involved, the row names it and opens it.
 *
 *  2. **Nothing is invented.** Every rule below reads a field the endpoint
 *     genuinely returns. There is no lead-scoring model, no churn prediction
 *     and no "AI insight": what the data supports is a set of dates compared
 *     against a clock, and that turns out to be most of what a salesperson
 *     needs anyway.
 *
 *  3. **Severity means urgency, not size.** A ninety-million deal that closes
 *     in three weeks is not more urgent than a two-million one that closed
 *     yesterday and nobody has updated. Value orders the rows within a
 *     severity; it does not set it.
 *
 * ── Why this is computed in the client ───────────────────────────────────
 *
 * Same reason the dashboard's is: the rules are presentation. They change with
 * the design, they are cheap over a payload that has already arrived, and
 * putting them on the server would mean a schema migration every time somebody
 * decided thirty days was the wrong threshold for "gone quiet".
 */

const RANK = { critical: 0, warning: 1, info: 2 } as const;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function buildCrmAttention(data: CrmOverview): CrmAttentionItem[] {
  const items: CrmAttentionItem[] = [];

  /* ── Follow-ups ───────────────────────────────────────────────────────────
     First, and critical, because a follow-up is a promise somebody made to a
     customer with a date on it. Everything else on this list is a judgement;
     this one is an unkept commitment. */

  const overdue = data.followups.filter(f => f.when === 'overdue');
  const dueToday = data.followups.filter(f => f.when === 'today');

  if (overdue.length) {
    const one = overdue.length === 1 ? overdue[0] : null;
    items.push({
      id: 'followups-overdue',
      severity: 'critical',
      title: one
        ? one.subject
        : `${overdue.length} ${plural(overdue.length, 'follow-up')} overdue`,
      detail: one
        ? (one.company?.name ?? one.deal?.name ?? personName(one.contact ?? one.lead) ?? 'No customer named')
        : 'The oldest is ' + relativeAge(overdue[overdue.length - 1]?.dueAt),
      state: 'Past due',
      go: { label: 'Open Activities', section: 'activities' },
    });
  }

  if (dueToday.length) {
    items.push({
      id: 'followups-today',
      severity: 'warning',
      title: `${dueToday.length} ${plural(dueToday.length, 'follow-up')} due today`,
      detail: dueToday.slice(0, 2).map(f => f.subject).join(' · '),
      state: 'Today',
      go: { label: 'Open Activities', section: 'activities' },
    });
  }

  /* ── Deals whose close date has passed ────────────────────────────────────
     An open deal dated in the past is either won, lost, or slipping, and all
     three mean somebody has to do something. It is the single most reliable
     signal of a pipeline nobody is maintaining. */

  const late = data.closingSoon.filter(d => {
    const left = daysUntil(d.expectedClose);
    return left !== null && left < 0;
  });

  if (late.length) {
    const value = late.reduce((s, d) => s + d.value, 0);
    const one = late.length === 1 ? late[0] : null;
    items.push({
      id: 'deals-late',
      severity: 'critical',
      title: one ? one.name : `${late.length} deals past their close date`,
      detail: one
        ? `${money(one.value, data.currency)} · was due ${relativeAge(one.expectedClose)}`
        : `${money(value, data.currency)} still open`,
      state: 'Date passed',
      go: one
        ? { label: 'Open deal', section: 'deals', focus: { type: 'deal', id: one.id } }
        : { label: 'Open Deals', section: 'deals' },
    });
  }

  /* ── Closing soon, with nobody booked in ──────────────────────────────────
     `hasNextAction` is set by the server from everybody's diary, not just the
     caller's - see the note on it in `types.ts`. This is the rule that earns
     the extra query: "closing in nine days and no one has arranged to speak to
     them" is a sentence a salesperson acts on immediately. */

  const soonUnbooked = data.closingSoon.filter(d => {
    const left = daysUntil(d.expectedClose);
    return left !== null && left >= 0 && left <= 14 && d.hasNextAction === false;
  });

  if (soonUnbooked.length) {
    const one = soonUnbooked.length === 1 ? soonUnbooked[0] : null;
    items.push({
      id: 'deals-unbooked',
      severity: 'warning',
      title: one
        ? one.name
        : `${soonUnbooked.length} deals close soon with nothing scheduled`,
      detail: one
        ? `${money(one.value, data.currency)} · closes ${relativeAge(one.expectedClose)}, no follow-up`
        : money(soonUnbooked.reduce((s, d) => s + d.value, 0), data.currency),
      state: 'No next step',
      go: one
        ? { label: 'Open deal', section: 'deals', focus: { type: 'deal', id: one.id } }
        : { label: 'Open Pipeline', section: 'pipeline' },
    });
  }

  /* ── Gone quiet ─────────────────────────────────────────────────────────── */

  if (data.stale.length) {
    const value = data.stale.reduce((s, d) => s + d.value, 0);
    items.push({
      id: 'deals-stale',
      severity: 'warning',
      title: `${data.stale.length} ${plural(data.stale.length, 'deal')} nobody has touched in a month`,
      detail: `${money(value, data.currency)} · oldest ${relativeAge(data.stale[0]?.updatedAt)}`,
      state: 'Gone quiet',
      go: { label: 'Open Pipeline', section: 'pipeline' },
    });
  }

  /* ── New leads sitting unworked ───────────────────────────────────────────
     Three days, because a lead that arrived this morning is not a problem and
     a lead that arrived last week is. `unworked` is already filtered to
     status = new by the endpoint. */

  const cold = data.leads.unworked.filter(l => {
    const age = daysUntil(l.createdAt);
    return age !== null && age <= -3;
  });

  if (cold.length) {
    items.push({
      id: 'leads-cold',
      severity: 'warning',
      title: `${cold.length} new ${plural(cold.length, 'lead')} not yet contacted`,
      detail: cold.slice(0, 2)
        .map(l => personName(l) || l.companyName || 'Unnamed')
        .join(' · '),
      state: 'Waiting',
      go: { label: 'Open Leads', section: 'leads' },
    });
  }

  /* ── Unassigned ───────────────────────────────────────────────────────────
     An unowned lead is the most reliable way for one to be lost: nobody's
     queue has it in, so nobody is wrong for not working it. */

  const unowned = data.leads.unworked.filter(l => !l.ownerId);
  if (unowned.length) {
    items.push({
      id: 'leads-unowned',
      severity: 'info',
      title: `${unowned.length} ${plural(unowned.length, 'lead')} with no owner`,
      detail: 'Nobody is on the hook for these.',
      state: 'Unassigned',
      go: { label: 'Open Leads', section: 'leads' },
    });
  }

  /* ── Coming up ────────────────────────────────────────────────────────────
     Deliberately last and deliberately `info`: it is not a problem, it is the
     week ahead, and a queue that only ever shows trouble is one people learn
     to dread rather than read. */

  const upcoming = data.followups.filter(f => f.when === 'upcoming');
  if (upcoming.length && !overdue.length && !dueToday.length) {
    items.push({
      id: 'followups-upcoming',
      severity: 'info',
      title: `${upcoming.length} ${plural(upcoming.length, 'follow-up')} coming up`,
      detail: `Next: ${upcoming[0].subject} ${relativeAge(upcoming[0].dueAt)}`,
      state: 'Scheduled',
      go: { label: 'Open Activities', section: 'activities' },
    });
  }

  return items.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** "3 days ago", "in 9 days" - the same words the rest of the module uses. */
function relativeAge(iso: string | null | undefined): string {
  const d = daysUntil(iso);
  if (d === null) return 'at some point';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${Math.abs(d)} days ago`;
}
