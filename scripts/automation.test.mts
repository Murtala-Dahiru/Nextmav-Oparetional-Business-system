import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { workflowSchema, draftWorkflowSchema } from '../src/lib/crm/automation.ts';
const action = { id: randomUUID(), type: 'create_task', text: 'Call customer', minutes: 60, branch: 'always', memberId: '' };
const w = { trigger: 'lead.created', conditions: { mode: 'all', groups: [] }, steps: [action] };
test('supports valid bounded workflows and incomplete drafts', () => {
 assert.ok(workflowSchema.safeParse(w).success);
 assert.ok(draftWorkflowSchema.safeParse({...w,steps:[]}).success);
 assert.equal(workflowSchema.safeParse({...w,steps:[]}).success,false);
});
test('rejects unsafe actions, duplicate identities and excessive resources', () => {
 for (const steps of [[{...action,type:'http'}],[action,action],Array.from({length:21},()=>({...action,id:randomUUID()})),[{...action,minutes:43201}]]) assert.equal(workflowSchema.safeParse({...w,steps}).success,false);
});
test('enforces typed and trigger-compatible conditions', () => {
 for (const rule of [{field:'value',operator:'greater',value:'100'},{field:'source',operator:'greater',value:'10'},{field:'notes',operator:'contains',value:'secret'},{field:'source',operator:'before',value:'2026-12-01'}]) assert.equal(workflowSchema.safeParse({...w,conditions:{mode:'all',groups:[{mode:'all',rules:[rule]}]}}).success,false);
 assert.ok(workflowSchema.safeParse({...w,trigger:'deal.created',conditions:{mode:'any',groups:[{mode:'all',rules:[{field:'value',operator:'greater',value:'100'}]},{mode:'any',rules:[{field:'currency',operator:'in',value:'NGN,USD'}]}]}}).success);
});
test('enforces recipients and action compatibility', () => {
 for (const a of [{...action,type:'notify'}, {...action,type:'assign_owner'}, {...action,type:'update_next_step'}, {...action,type:'update_lead_status',text:'arbitrary'}]) assert.equal(workflowSchema.safeParse({...w,steps:[a]}).success,false);
});
test('rejects malformed drafts and unknown executable fields', () => {
 for (const value of [{}, {...w,steps:null}, {...w,conditions:{groups:[{}]}}, {...w,script:'eval(1)'}]) assert.equal(draftWorkflowSchema.safeParse(value).success,false);
});
