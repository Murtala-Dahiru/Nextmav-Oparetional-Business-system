import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dealCurrencySchema} from '../src/lib/crm/currency';
import {pipelineFiltersSchema} from '../src/lib/crm/pipeline-filters';
import {updateDealSchema} from '../src/lib/validations';
test('currency contracts reject unsupported codes and preserve sparse edits',()=>{
 for(const currency of ['USD','EUR','GBP','NGN','JPY','KWD'])assert.equal(dealCurrencySchema.parse(currency),currency);
 for(const currency of ['ZZZ','usd','','US','USD EUR',null])assert.equal(dealCurrencySchema.safeParse(currency).success,false);
 assert.equal(updateDealSchema.safeParse({value:1.234}).success,false);
 assert.deepEqual(updateDealSchema.parse({value:1234.56}),{value:1234.56});
 assert.equal(updateDealSchema.parse({currency:'EUR'}).currency,'EUR');
 assert.equal(pipelineFiltersSchema.parse({currency:'JPY'}).currency,'JPY');
 assert.equal(pipelineFiltersSchema.safeParse({currency:'ZZZ'}).success,false);
});


test('downstream monetary rollups retain currency boundaries and outcome counts',async()=>{
 const {rollUp}=await import('../src/lib/performance');
 const event=(entityId:string,currency:string,value:number)=>({eventType:'deal.won' as const,entityId,subjectMemberId:'member',occurredAt:'2026-10-01',payload:{currency,value}});
 const events=[event('one','USD',1200),event('two','EUR',3000)];
 assert.equal(rollUp(events,'USD').revenueWon,1200);
 assert.equal(rollUp(events,'EUR').revenueWon,3000);
 assert.equal(rollUp(events,'USD').dealsWon,2);
 assert.equal(rollUp(events,'USD').averageDeal,1200);
 assert.equal(rollUp(events,'JPY').averageDeal,null);
 const reopened=[...events,{...events[0],eventType:'deal.reopened' as const}];
 assert.equal(rollUp(reopened,'USD').revenueWon,0);
 assert.equal(rollUp(reopened,'EUR').revenueWon,3000);
});
