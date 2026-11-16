import { z } from 'zod';

export const triggers = ['lead.created', 'lead.assigned', 'lead.status_changed', 'lead.qualified', 'lead.converted', 'lead.no_response', 'company.created', 'company.inactive', 'company.action_overdue', 'company.owner_changed', 'contact.created', 'contact.relationship_updated', 'deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost', 'deal.owner_changed', 'deal.closing_soon', 'deal.stalled', 'activity.created', 'activity.completed', 'activity.meeting_scheduled', 'activity.overdue', 'commercial.quote_submitted', 'commercial.quote_approved', 'commercial.quote_rejected', 'commercial.proposal_approved', 'commercial.contract_executed', 'agreement.sent', 'agreement.completed', 'agreement.declined', 'agreement.changes_requested'] as const;
export const fields = {
  source: { label: 'Lead source', type: 'text', entities: ['lead'] },
  status: { label: 'Record status', type: 'text', entities: ['lead','commercial','agreement'] },
  industry: { label: 'Industry', type: 'text', entities: ['lead', 'company'] },
  segment: { label: 'Company segment', type: 'text', entities: ['company'] },
  relationshipRole: { label: 'Contact relationship role', type: 'text', entities: ['contact'] },
  influence: { label: 'Contact influence', type: 'text', entities: ['contact'] },
  owner_id: { label: 'Record owner', type: 'text', entities: ['lead', 'deal', 'company', 'contact','commercial','agreement'] },
  stage: { label: 'Deal stage', type: 'text', entities: ['deal'] },
  value: { label: 'Commercial or deal value', type: 'number', entities: ['deal','commercial'] },
  currency: { label: 'Record currency', type: 'text', entities: ['deal','commercial'] },
  expected_close: { label: 'Expected close', type: 'date', entities: ['deal'] },
  due_at: { label: 'Activity or account action due date', type: 'date', entities: ['activity', 'company'] },
  completed_at: { label: 'Activity completed at', type: 'date', entities: ['activity'] },
} as const;
export const operators = ['equals', 'not_equals', 'contains', 'in', 'greater', 'less', 'before', 'after', 'empty', 'not_empty'] as const;
const rule = z.object({ field: z.union([z.enum(Object.keys(fields) as [keyof typeof fields, ...Array<keyof typeof fields>]),z.templateLiteral(['custom:',z.uuid()])]), operator: z.enum(operators), value: z.string().max(500).default('') }).strict();
const group = z.object({ mode: z.enum(['all', 'any']), rules: z.array(rule).max(12) }).strict();
export const conditionsSchema = z.object({ mode: z.enum(['all', 'any']), groups: z.array(group).max(4) }).strict();
export const actionTypes = ['assign_lead', 'reassign_lead', 'assign_owner', 'create_task', 'create_account_action', 'notify', 'wait', 'check', 'update_next_step', 'update_lead_status', 'add_tag'] as const;
const step = z.object({
  id: z.uuid(), type: z.enum(actionTypes), memberId: z.union([z.uuid(), z.literal('')]).default(''),
  text: z.string().max(250).default(''), minutes: z.number().int().min(1).max(43200).default(60),
  branch: z.enum(['always', 'matched', 'unmatched']).default('always'),
}).strict();
export const draftWorkflowSchema = z.object({ trigger: z.enum(triggers), scheduleMinutes: z.number().int().min(1).max(43200).default(1440), conditions: conditionsSchema, steps: z.array(step).max(20) }).strict();
export const workflowSchema = draftWorkflowSchema.superRefine((w, ctx) => {
  if (!w.steps.length) ctx.addIssue({ code: 'custom', message: 'Add at least one action' });
  const entity = w.trigger.split('.')[0];
  if (new Set(w.steps.map(s => s.id)).size !== w.steps.length) ctx.addIssue({ code: 'custom', message: 'Step identities must be unique' });
  for (const g of w.conditions.groups) for (const r of g.rules) {
    if (r.field.startsWith('custom:')) {
      if(!['lead.created','contact.created','deal.created','deal.stage_changed','lead.status_changed','lead.assigned','deal.owner_changed'].includes(w.trigger) || !['equals','not_equals','empty','not_empty'].includes(r.operator)) ctx.addIssue({code:'custom',message:'Custom field conditions support equality and presence on selected record events'});
      continue;
    }
    const f = fields[r.field as keyof typeof fields];
    if (!(f.entities as readonly string[]).includes(entity)) ctx.addIssue({ code: 'custom', message: `${f.label} is not available for this trigger` });
    if (['greater', 'less'].includes(r.operator) && (f.type !== 'number' || !r.value.trim() || !Number.isFinite(Number(r.value)))) ctx.addIssue({ code: 'custom', message: 'Numeric comparison requires a numeric field and value' });
    if (['before', 'after'].includes(r.operator) && (f.type !== 'date' || !/^\d{4}-\d{2}-\d{2}/.test(r.value) || !Number.isFinite(Date.parse(r.value)))) ctx.addIssue({ code: 'custom', message: 'Date comparison requires a valid date field and value' });
    if (['contains', 'in'].includes(r.operator) && f.type !== 'text') ctx.addIssue({ code: 'custom', message: 'Text operator requires a text field' });
    if (['equals', 'not_equals'].includes(r.operator) && f.type === 'number' && (!r.value.trim() || !Number.isFinite(Number(r.value)))) ctx.addIssue({ code: 'custom', message: 'Enter a numeric comparison value' });
    if (['equals', 'not_equals'].includes(r.operator) && f.type === 'date' && !Number.isFinite(Date.parse(r.value))) ctx.addIssue({ code: 'custom', message: 'Enter a valid comparison date' });
  }
  for (const s of w.steps) {
    if(entity==='agreement'&&!['notify','wait','check'].includes(s.type))ctx.addIssue({code:'custom',message:'Agreement triggers support notification, wait and condition actions'});
    if (s.type === 'create_account_action' && (entity !== 'company' || !s.text.trim())) ctx.addIssue({ code: 'custom', message: 'Account-plan actions require a company trigger and a title' });
    if (s.type === 'add_tag' && (!['company', 'contact'].includes(entity) || !s.text.trim() || s.text.length > 60)) ctx.addIssue({ code: 'custom', message: 'Account/contact tags require 1–60 characters' });
    if (['assign_lead', 'reassign_lead', 'update_lead_status'].includes(s.type) && entity !== 'lead') ctx.addIssue({ code: 'custom', message: 'Lead actions require a lead trigger' });
    if (s.type === 'update_lead_status' && !['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'].includes(s.text)) ctx.addIssue({ code: 'custom', message: 'Choose a supported lead status' });
    if (s.type === 'assign_owner' && !['deal', 'company'].includes(entity)) ctx.addIssue({ code: 'custom', message: 'Owner assignment supports deals and companies' });
    if (s.type === 'update_next_step' && entity !== 'deal') ctx.addIssue({ code: 'custom', message: 'Next step updates require a deal' });
    if (['notify', 'assign_owner'].includes(s.type) && !s.memberId) ctx.addIssue({ code: 'custom', message: 'Choose a recipient or owner' });
    if (['notify', 'create_task', 'update_next_step'].includes(s.type) && !s.text.trim()) ctx.addIssue({ code: 'custom', message: 'Enter a task, notification, or next step description' });
  }
});
export type Workflow = Omit<z.infer<typeof workflowSchema>, 'scheduleMinutes'> & { scheduleMinutes?: number };
export type Conditions = z.infer<typeof conditionsSchema>;
export const emptyConditions: Conditions = { mode: 'all', groups: [] };
export function newStep(type: Workflow['steps'][number]['type'] = 'create_task'): Workflow['steps'][number] {
  return { id: crypto.randomUUID(), type, text: '', minutes: 60, memberId: '', branch: 'always' };
}
export const templates = [
  { name: 'New lead handoff', description: 'Use your existing assignment rules, then create a follow-up. Configure assignment rules first.', trigger: 'lead.created', actions: ['assign_lead', 'create_task'] },
  { name: 'Qualified lead follow-up', description: 'Create a next action when a lead becomes qualified.', trigger: 'lead.qualified', actions: ['create_task'] },
  { name: 'New opportunity', description: 'Give each new deal a clear next action.', trigger: 'deal.created', actions: ['create_task'] },
  { name: 'Stage follow-up', description: 'Follow up after an authorized pipeline stage change.', trigger: 'deal.stage_changed', actions: ['create_task'] },
  { name: 'Won-deal announcement', description: 'Notify a selected team member when a deal is won. Choose a recipient.', trigger: 'deal.won', actions: ['notify'] },
  { name: 'Untouched lead escalation', description: 'Create an escalation for a lead still new after the configured inactivity period.', trigger: 'lead.no_response', actions: ['create_task'] },
  { name: 'Stalled opportunity', description: 'Create a follow-up when an open opportunity has not been updated within the configured period.', trigger: 'deal.stalled', actions: ['create_task'] },
  { name: 'Closing-soon alert', description: 'Notify a chosen colleague when an open deal enters the configured closing window.', trigger: 'deal.closing_soon', actions: ['notify'] },
  { name: 'Overdue account action', description: 'Escalate an incomplete structured account-plan action after its due date and grace period.', trigger: 'company.action_overdue', actions: ['create_task'] },
  { name: 'Relationship inactivity reminder', description: 'Follow up when an account has no recorded call, email or completed meeting within the configured period.', trigger: 'company.inactive', actions: ['create_task'] },
  { name: 'Overdue follow-up escalation', description: 'Wait, recheck completion, and create an escalation task. Set the delay to your follow-up SLA.', trigger: 'activity.created', actions: ['wait', 'check', 'create_task'] },
] as const;
