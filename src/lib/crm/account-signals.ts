export type RelationshipSignal = { key: string; title: string; evidence: string; action: string; section: 'profile'|'people'|'deals'|'plan'|'activity'|'money'|'support'; severity: 'attention'|'risk'|'info' };
export function accountSignals(input: {
 ownerAssigned:boolean; segment?:string; lastContact:string|null; openDeals:number; decisionMakers:number;
 overdueActions:number; stalledDeals:number; openTickets?:number; overdueInvoices?:number; nextFollowUp:string|null;
}, now=new Date()): {status:'Healthy'|'Needs attention'|'At risk'|'Insufficient information';signals:RelationshipSignal[]} {
 const signals:RelationshipSignal[]=[];
 if(!input.ownerAssigned) signals.push({key:'owner',title:'Assign an account owner',evidence:input.segment?`${input.segment} account has no assigned owner.`:'No account owner is recorded.',action:'Set owner',section:'profile',severity:'attention'});
 const days=input.lastContact?Math.floor((now.getTime()-Date.parse(input.lastContact))/86400000):null;
 if(days===null||days>=30) signals.push({key:'engagement',title:days===null?'Establish engagement history':'Reconnect with this account',evidence:days===null?'No completed call, email or meeting is recorded.':`Last recorded call, email or meeting was ${days} days ago.`,action:'Review timeline',section:'activity',severity:days===null?'info':'attention'});
 if(input.openDeals>0&&input.decisionMakers===0) signals.push({key:'stakeholder',title:'Identify the buying stakeholders',evidence:`${input.openDeals} open opportunities; no active contact is explicitly recorded as decision-maker or economic buyer.`,action:'Review contacts',section:'people',severity:'attention'});
 if(input.overdueActions>0) signals.push({key:'actions',title:'Resolve overdue commitments',evidence:`${input.overdueActions} recorded follow-ups or account actions are overdue.`,action:'Review account plan',section:'plan',severity:'risk'});
 if(input.stalledDeals>0) signals.push({key:'stalled',title:'Review quiet opportunities',evidence:`${input.stalledDeals} open opportunities have no record update in 30 days. This is a review rule, not a prediction.`,action:'Review opportunities',section:'deals',severity:'attention'});
 if(input.openTickets&&input.openTickets>0) signals.push({key:'support',title:'Review unresolved support',evidence:`${input.openTickets} visible tickets remain unresolved.`,action:'Open support context',section:'support',severity:'attention'});
 if(input.overdueInvoices&&input.overdueInvoices>0) signals.push({key:'collections',title:'Review overdue invoices',evidence:`${input.overdueInvoices} visible invoices are past due.`,action:'Review finance',section:'money',severity:'risk'});
 if(input.nextFollowUp&&Date.parse(input.nextFollowUp)>=now.getTime()) signals.push({key:'upcoming',title:'Prepare for the next commitment',evidence:`A follow-up is scheduled for ${input.nextFollowUp.slice(0,10)}.`,action:'Review activities',section:'activity',severity:'info'});
 return {status:signals.some(s=>s.severity==='risk')?'At risk':signals.some(s=>s.severity==='attention')?'Needs attention':!input.lastContact?'Insufficient information':'Healthy',signals};
}
