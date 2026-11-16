/** Pure assignment decisions. The caller must load an authorized snapshot and
 * commit the decision + idempotency key in the same serialized transaction.
 * This module does not send notifications or pretend to run an automation. */
export type AssignmentMode = 'round_robin' | 'territory' | 'industry' | 'service_interest' | 'account_owner' | 'workload';
export interface AssignmentMember {
  id: string;
  organizationId: string;
  active: boolean;
  canOwnLeads: boolean;
  openLeadCount: number;
  lastAssignedSequence: number;
}
export interface AssignmentRule {
  id: string;
  organizationId: string;
  enabled: boolean;
  priority: number;
  mode: AssignmentMode;
  memberIds: string[];
  matches: string[];
}
export interface AssignmentInput {
  organizationId: string;
  leadId: string;
  requestKey: string;
  currentOwnerId: string | null;
  allowReassignment: boolean;
  territory?: string | null;
  industry?: string | null;
  serviceInterest?: string | null;
  /** Only use a known relationship, not a fuzzy company-name match. */
  accountOwnerId?: string | null;
  fallbackMemberId?: string | null;
  members: AssignmentMember[];
  rules: AssignmentRule[];
  previous?: AssignmentDecision;
}
export interface AssignmentDecision {
  organizationId: string;
  leadId: string;
  requestKey: string;
  ownerId: string | null;
  ruleId: string | null;
  reason: 'already_owned' | 'account_owner' | 'round_robin' | 'territory' | 'industry' | 'service_interest' | 'workload' | 'fallback' | 'unassigned';
}
const normalize = (value?: string | null) => value?.trim().toLocaleLowerCase('en-US') ?? '';

export function decideLeadAssignment(input: AssignmentInput): AssignmentDecision {
  if(!input.organizationId || !input.leadId || !input.requestKey.trim()) throw new Error('Assignment identity is required');
  if(input.previous) {
    if(input.previous.organizationId!==input.organizationId || input.previous.leadId!==input.leadId || input.previous.requestKey!==input.requestKey)
      throw new Error('Assignment retry identity does not match');
    return {...input.previous};
  }
  const decision = (ownerId: string | null,ruleId: string | null,reason:AssignmentDecision['reason']):AssignmentDecision => ({organizationId:input.organizationId,leadId:input.leadId,requestKey:input.requestKey,ownerId,ruleId,reason});
  // An automated run must not silently undo someone's manual assignment.
  if(input.currentOwnerId && !input.allowReassignment) return decision(input.currentOwnerId,null,'already_owned');
  const eligible = input.members.filter(m=>m.organizationId===input.organizationId && m.active && m.canOwnLeads);
  if(new Set(eligible.map(m=>m.id)).size!==eligible.length) throw new Error('Duplicate assignment members');
  for(const member of eligible) {
    if(!Number.isSafeInteger(member.openLeadCount) || member.openLeadCount<0 || !Number.isSafeInteger(member.lastAssignedSequence) || member.lastAssignedSequence<0)
      throw new Error('Assignment workload and sequence must be non-negative integers');
  }
  const rules = input.rules.filter(r=>r.organizationId===input.organizationId && r.enabled)
    .sort((a,b)=>a.priority-b.priority || a.id.localeCompare(b.id));
  for(const rule of rules) {
    if(!Number.isFinite(rule.priority)) throw new Error('Assignment rule priority must be finite');
    if(['territory','industry','service_interest'].includes(rule.mode)) {
      const value=normalize(rule.mode==='territory' ? input.territory : rule.mode==='industry' ? input.industry : input.serviceInterest);
      if(!value || !rule.matches.some(match=>normalize(match)===value)) continue;
    }
    const pool=eligible.filter(m=>rule.memberIds.includes(m.id));
    if(rule.mode==='account_owner') {
      const owner=pool.find(m=>m.id===input.accountOwnerId);
      if(owner) return decision(owner.id,rule.id,'account_owner');
      continue;
    }
    pool.sort((a,b)=>(rule.mode==='workload' ? a.openLeadCount-b.openLeadCount : 0)
      || a.lastAssignedSequence-b.lastAssignedSequence || a.id.localeCompare(b.id));
    if(pool[0]) return decision(pool[0].id,rule.id,rule.mode);
  }
  const fallback=eligible.find(m=>m.id===input.fallbackMemberId);
  return fallback ? decision(fallback.id,null,'fallback') : decision(null,null,'unassigned');
}
