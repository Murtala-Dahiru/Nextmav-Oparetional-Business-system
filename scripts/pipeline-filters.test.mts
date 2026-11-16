import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pipelineFiltersSchema} from '../src/lib/crm/pipeline-filters';
test('pipeline filters reject reversed periods, invalid identifiers and unsupported amounts',()=>{
 for(const filters of [{closeFrom:'2026-12-01',closeTo:'2026-01-01'},{minValue:'100',maxValue:'50'},{ownerId:'foreign'},{minValue:'-5'},{maxValue:'Infinity'},{closeFrom:'2026-02-30'},{forecastCategory:'invented'}])assert.equal(pipelineFiltersSchema.safeParse(filters).success,false);
 assert.ok(pipelineFiltersSchema.safeParse({closeFrom:'2026-12-01',closeTo:'2026-12-31',minValue:'0',maxValue:'1000.50',stage:'open',forecastCategory:'commit'}).success);
});
