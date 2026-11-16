import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decideLeadAssignment,type AssignmentInput,type AssignmentRule} from '../src/lib/crm/assignment';
const base:AssignmentInput={organizationId:'org',leadId:'lead',requestKey:'run-1',currentOwnerId:null,allowReassignment:false,members:[
  {id:'a',organizationId:'org',active:true,canOwnLeads:true,openLeadCount:3,lastAssignedSequence:9},
  {id:'b',organizationId:'org',active:true,canOwnLeads:true,openLeadCount:9,lastAssignedSequence:3},
],rules:[]};
const rule=(mode:AssignmentRule['mode']):AssignmentRule=>({id:'rule',organizationId:'org',enabled:true,priority:1,mode,memberIds:['a','b'],matches:['Lagos','Healthcare','Consulting']});
test('round robin and workload use different deterministic priorities',()=>{
  assert.equal(decideLeadAssignment({...base,rules:[rule('round_robin')]}).ownerId,'b');
  assert.equal(decideLeadAssignment({...base,rules:[rule('workload')]}).ownerId,'a');
});
test('territory, industry and service matching is normalized and exact',()=>{
  for(const [mode,key,value] of [['territory','territory',' Lagos '],['industry','industry','healthcare'],['service_interest','serviceInterest','CONSULTING']] as const) {
    assert.equal(decideLeadAssignment({...base,[key]:value,rules:[rule(mode)]}).ownerId,'b');
    assert.equal(decideLeadAssignment({...base,[key]:value+' extra',rules:[rule(mode)]}).ownerId,null);
  }
});
test('known account ownership is used only when eligible in the rule pool',()=>{
  assert.equal(decideLeadAssignment({...base,accountOwnerId:'a',rules:[rule('account_owner')]}).ownerId,'a');
  assert.equal(decideLeadAssignment({...base,accountOwnerId:'foreign',rules:[rule('account_owner')]}).ownerId,null);
});
test('cross-tenant, inactive and ineligible members and rules cannot receive leads',()=>{
  for(const change of [{organizationId:'foreign'},{active:false},{canOwnLeads:false}]) {
    assert.equal(decideLeadAssignment({...base,members:base.members.map(m=>({...m,...change})),rules:[rule('round_robin')],fallbackMemberId:'a'}).ownerId,null);
  }
  assert.equal(decideLeadAssignment({...base,rules:[{...rule('round_robin'),organizationId:'foreign'}]}).ownerId,null);
});
test('manual assignments survive, retries remain stable and mismatched keys fail',()=>{
  assert.equal(decideLeadAssignment({...base,currentOwnerId:'a',rules:[rule('round_robin')]}).reason,'already_owned');
  const previous=decideLeadAssignment({...base,rules:[rule('round_robin')]});
  assert.deepEqual(decideLeadAssignment({...base,previous,rules:[rule('workload')]}),previous);
  assert.throws(()=>decideLeadAssignment({...base,previous,requestKey:'another'}),/identity/);
});
test('fallback, rule precedence, disabled rules, missing matches and invalid workload are explicit',()=>{
  assert.equal(decideLeadAssignment({...base,fallbackMemberId:'a'}).reason,'fallback');
  assert.equal(decideLeadAssignment({...base,rules:[{...rule('workload'),enabled:false}],fallbackMemberId:'b'}).ownerId,'b');
  assert.equal(decideLeadAssignment({...base,rules:[{...rule('round_robin'),id:'later',priority:2},rule('workload')]}).ownerId,'a');
  assert.throws(()=>decideLeadAssignment({...base,members:[{...base.members[0],openLeadCount:NaN}]}),/non-negative/);
  assert.equal(decideLeadAssignment({...base,rules:[rule('territory')]}).reason,'unassigned');
});
