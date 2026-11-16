import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {citext} from '@electric-sql/pglite/contrib/citext';
import {pipelineSchema} from '../src/lib/crm/pipelines';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('pipeline configuration rejects duplicate stages, foreign transitions and invalid revisions',()=>{
 const stage={id:id(100),name:'Discovery',canonicalStage:'prospecting',probability:20,inactivityDays:7};
 const input={id:null,version:0,name:'New business',purpose:'new_business',stages:[stage,{...stage,id:id(101)}]};
 assert.ok(pipelineSchema.safeParse(input).success);
 assert.equal(pipelineSchema.safeParse({...input,version:1}).success,false);
 assert.equal(pipelineSchema.safeParse({...input,stages:[stage,stage]}).success,false);
 assert.equal(pipelineSchema.safeParse({...input,stages:[{...stage,allowedNext:[id(999)]},{...stage,id:id(101)}]}).success,false);
 assert.equal(pipelineSchema.safeParse({...input,organizationId:id(2)}).success,false);
});

test('configured pipelines enforce requirements, approvals, isolation and historical compatibility',async()=>{
 const db=new PGlite({extensions:{citext}});
 try {
  await db.exec(`SET timezone='UTC'; CREATE EXTENSION citext; CREATE ROLE authenticated; CREATE ROLE anon;
   CREATE TABLE organizations(id uuid PRIMARY KEY);
   CREATE TABLE organization_members(id uuid PRIMARY KEY,organization_id uuid,role text);
   CREATE FUNCTION auth_member_id(org uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM organization_members WHERE organization_id=org AND id=nullif(current_setting('test.member',true),'')::uuid $$;
   CREATE FUNCTION auth_role_in(org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role FROM organization_members WHERE organization_id=org AND id=auth_member_id(org) $$;
   CREATE FUNCTION can_access_module(org uuid,module text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth_member_id(org) IS NOT NULL $$;
   CREATE TYPE lead_status AS ENUM('new','contacted','qualified','proposal','negotiation','won','lost');
   CREATE TYPE deal_stage AS ENUM('prospecting','qualification','proposal','negotiation','closed_won','closed_lost');`);
  const base=readFileSync('supabase/migrations/0003_business_tables.sql','utf8');
  for(const table of ['companies','contacts','leads','deals','crm_activities']) {
   const match=base.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));assert.ok(match);await db.exec(match[0]);
   await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; CREATE POLICY baseline ON ${table} TO authenticated USING(can_access_module(organization_id,'crm')) WITH CHECK(can_access_module(organization_id,'crm')); GRANT ALL ON ${table} TO authenticated;`);
  }
  const history=readFileSync('supabase/migrations/0028_crm_followups_and_movement.sql','utf8');
  const eventTable=history.match(/CREATE TABLE IF NOT EXISTS deal_stage_events \([\s\S]*?\n\);/);assert.ok(eventTable);await db.exec(eventTable[0]);
  await db.exec('GRANT SELECT ON deal_stage_events TO authenticated');
  for(const name of ['stamp_deal_closure','record_deal_stage_change']){
   const fn=history.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\n\\$\\$;`));assert.ok(fn);await db.exec(fn[0]);
  }
  await db.exec(`CREATE TRIGGER trg_stamp_deal_closure BEFORE INSERT OR UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION stamp_deal_closure(); CREATE TRIGGER trg_record_deal_stage AFTER INSERT OR UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION record_deal_stage_change();`);
  await db.exec(readFileSync('supabase/migrations/0050_crm_conversion_and_access.sql','utf8'));
  const migration=readFileSync('supabase/migrations/0054_crm_configurable_pipelines.sql','utf8');await db.exec(migration);await db.exec(migration);
  await db.exec(readFileSync('supabase/migrations/0059_crm_intelligence.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0064_crm_deal_execution.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0055_crm_lead_qualification.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0058_crm_relationship_profiles.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0065_crm_priority_completeness.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0066_crm_pipeline_forecast.sql','utf8'));
  await db.exec(`INSERT INTO organizations VALUES('${id(1)}'),('${id(2)}'); INSERT INTO organization_members VALUES('${id(10)}','${id(1)}','owner'),('${id(11)}','${id(1)}','sales_staff'),('${id(20)}','${id(2)}','owner'); SET ROLE authenticated; SELECT set_config('test.member','${id(10)}',false);`);
  const stages=[
   {id:id(100),name:'Discovery',canonicalStage:'prospecting',probability:15,inactivityDays:7,allowedNext:[id(101)],exitRequiredFields:['next_step']},
   {id:id(101),name:'Review',canonicalStage:'proposal',probability:60,inactivityDays:14,requiredFields:['value'],requiresApproval:true},
   {id:id(102),name:'Won',canonicalStage:'closed_won',probability:100,inactivityDays:30},
  ];
  const save=async(pipeline:string|null=null,version=0,items=stages)=>(await db.query<{id:string}>('SELECT crm_save_pipeline($1,$2,$3,$4,$5,$6) AS id',[id(1),pipeline,version,'Enterprise','enterprise',JSON.stringify(items)])).rows[0].id;
  const pipeline=await save();
  await assert.rejects(save(pipeline,0),/changed/);
  await assert.rejects(save(pipeline,1,[{...stages[0],ownerId:id(20)},...stages.slice(1)]),/another organization/);
  await db.query(`INSERT INTO deals(id,organization_id,name,owner_id,pipeline_id,pipeline_stage_id,value) VALUES($1,$2,'Opportunity',$3,$4,$5,1000)`,[id(200),id(1),id(11),pipeline,id(100)]);
  await assert.rejects(save(pipeline,1,stages.slice(1)),/Move deals/);
  await assert.rejects(save(pipeline,1,[{...stages[0],canonicalStage:'qualification'},...stages.slice(1)]),/occupied stage/);
  const move=(stage:number)=>db.query('UPDATE deals SET pipeline_stage_id=$1 WHERE id=$2',[id(stage),id(200)]);
  await assert.rejects(move(102),/not allowed/);
  await assert.rejects(move(101),/exit requirement/);
  await db.query('UPDATE deals SET next_step=$1 WHERE id=$2',['Review proposal',id(200)]);
  await assert.rejects(move(101),/needs approval/);
  await assert.rejects(db.query('SELECT crm_move_deal($1,$2,$3,$4)',[id(1),id(200),id(101),0]),/changed/);
  await assert.rejects(db.query('UPDATE deals SET pipeline_id=NULL,pipeline_stage_id=NULL WHERE id=$1',[id(200)]),/cannot bypass/);
  await db.exec(`SELECT set_config('test.member','${id(11)}',false)`);
  await assert.rejects(save(),/not permitted/);
  const request=async()=>(await db.query<{id:string}>('SELECT crm_request_stage_approval($1,$2,$3) AS id',[id(1),id(200),id(101)])).rows[0].id;
  const approval=await request();assert.equal(await request(),approval);
  await assert.rejects(db.query('SELECT crm_decide_stage_approval($1,$2,true,$3)',[id(1),approval,'OK']),/not permitted/);
  await db.exec(`SELECT set_config('test.member','${id(10)}',false)`);
  await db.query('SELECT crm_decide_stage_approval($1,$2,true,$3)',[id(1),approval,'Reviewed']);
  await db.query('UPDATE deals SET notes=$1 WHERE id=$2',['New commercial terms',id(200)]);
  await assert.rejects(move(101),/needs approval/);
  const fresh=await request();assert.notEqual(fresh,approval);
  await db.query('SELECT crm_decide_stage_approval($1,$2,true,$3)',[id(1),fresh,'Reviewed latest']);
  await assert.rejects(db.query('UPDATE deals SET pipeline_stage_id=$1,value=0 WHERE id=$2',[id(101),id(200)]),/Save deal changes/);
  // Failed transitions roll back approval consumption too.
  assert.equal((await db.query<{status:string}>('SELECT status FROM crm_stage_approvals WHERE id=$1',[fresh])).rows[0].status,'approved');
  const revision=(await db.query<{pipeline_version:number}>('SELECT pipeline_version FROM deals WHERE id=$1',[id(200)])).rows[0].pipeline_version;
  await db.query('SELECT crm_move_deal($1,$2,$3,$4)',[id(1),id(200),id(101),revision]);
  const row=(await db.query<{stage:string;probability:number}>('SELECT stage,probability FROM deals WHERE id=$1',[id(200)])).rows[0];
  assert.deepEqual(row,{stage:'proposal',probability:60});
  await assert.rejects(db.query('UPDATE deals SET value=0 WHERE id=$1',[id(200)]),/stage requirement/);
  await db.query(`UPDATE deals SET stage='closed_won',expected_close='2026-12-01' WHERE id=$1`,[id(200)]);
  assert.equal((await db.query<{pipeline_stage_id:string}>('SELECT pipeline_stage_id FROM deals WHERE id=$1',[id(200)])).rows[0].pipeline_stage_id,id(102));
  assert.equal((await db.query('SELECT * FROM crm_pipeline_events WHERE deal_id=$1',[id(200)])).rows.length,3);
  assert.ok((await db.query<{closed_at:string}>('SELECT closed_at FROM deals WHERE id=$1',[id(200)])).rows[0].closed_at);
  assert.deepEqual((await db.query<{to_stage:string}>('SELECT to_stage FROM deal_stage_events WHERE deal_id=$1 ORDER BY id',[id(200)])).rows.map(r=>r.to_stage),['prospecting','proposal','closed_won']);
  await db.query(`INSERT INTO leads(id,organization_id,first_name,owner_id,created_at,converted_at,converted_deal_id) VALUES($1,$2,'Cohort',$3,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z',$4)`,[id(300),id(1),id(11),id(200)]);
  await db.query(`INSERT INTO crm_activities(organization_id,lead_id,activity_type,subject,created_at,member_id) VALUES($1,$2,'email','First response','2026-01-01T02:00:00Z',$3)`,[id(1),id(300),id(11)]);
  const insights=(await db.query<{data:{cohort:{created:number;converted:number;opportunities:number;won:number};responses:{medianHours:number}}}>('SELECT crm_sales_insights($1,$2,$3,$4) AS data',[id(1),'2026-01-01','2026-12-31','UTC'])).rows[0].data;
  assert.deepEqual(insights.cohort,{created:1,converted:1,opportunities:1,won:1});assert.equal(insights.responses.medianHours,2);
  const partial=(await db.query<{data:{acquisition:{converted:number}[]}}>('SELECT crm_sales_insights($1,$2,$3,$4) AS data',[id(1),'2026-02-02','2026-02-15','UTC'])).rows[0].data;
  assert.equal(partial.acquisition[0].converted,0,'A partial-month range excludes conversions before the selected start');
  await assert.rejects(db.query('SELECT crm_sales_insights($1,$2,$3,$4)',[id(1),'2000-01-01','2026-12-31','UTC']),/Invalid reporting/);
  await assert.rejects(db.exec('DELETE FROM crm_pipeline_events'),/permission denied/);
  const current=(await db.query<{pipeline_version:number}>('SELECT pipeline_version FROM deals WHERE id=$1',[id(200)])).rows[0].pipeline_version;
  const execution={nextStep:'Handoff review',forecastCategory:'commit',competitor:'',outcomeNotes:'Signed',teamIds:[id(11)],services:[{name:'Implementation',quantity:2,unitPrice:500}]};
  const saveExecution=(version:number,details=execution)=>db.query('SELECT crm_save_deal_execution($1,$2,$3,$4)',[id(1),id(200),version,JSON.stringify(details)]);
  await assert.rejects(saveExecution(current,{...execution,teamIds:[id(20)]}),/team member/);
  await saveExecution(current);
  await assert.rejects(saveExecution(current),/changed/);
  assert.deepEqual((await db.query<{service_items:unknown}>('SELECT service_items FROM deals WHERE id=$1',[id(200)])).rows[0].service_items,execution.services);
  // Explainable completeness uses the organization's framework, never a fixed methodology.
  await db.query('SELECT crm_save_qualification_framework($1,0,$2,$3)', [id(1), 'Required evidence', JSON.stringify([{key:'confirmed',label:'Confirmed',type:'boolean',required:true},{key:'budget',label:'Budget',type:'number',required:true}])]);
  await db.query(`INSERT INTO contacts(id,organization_id,first_name) VALUES($1,$2,'Decision contact')`, [id(400),id(1)]);
  await db.query(`INSERT INTO deals(id,organization_id,name,owner_id,contact_id,next_step) VALUES($1,$2,'Completeness',$3,$4,'Discovery')`, [id(401),id(1),id(11),id(400)]);
  await db.query(`INSERT INTO leads(id,organization_id,first_name,owner_id,converted_deal_id) VALUES($1,$2,'Linked qualification',$3,$4)`, [id(402),id(1),id(11),id(401)]);
  const priorities = async () => (await db.query<{data:{priorities:{id:string;incomplete_qualification:boolean;missing_decision_context:boolean}[]}}>('SELECT crm_sales_insights($1,$2,$3,$4) AS data',[id(1),'2026-01-01','2026-12-31','UTC'])).rows[0].data.priorities;
  const incomplete = (await priorities()).find(p => p.id===id(401));
  assert.equal(incomplete?.incomplete_qualification,true);
  assert.equal(incomplete?.missing_decision_context,true);
  await db.query(`UPDATE leads SET qualification='{"confirmed":false,"budget":0}'::jsonb WHERE id=$1`,[id(402)]);
  await db.query(`UPDATE contacts SET crm_profile='{"influence":"Budget authority"}'::jsonb WHERE id=$1`,[id(400)]);
  assert.equal((await priorities()).some(p=>p.id===id(401)),false,'False and zero are valid answers; documented context resolves the priority');
  for (const [category,value] of [['commit',1000],['best_case',2000],['omitted',10000]] as const) {
    await db.query(`INSERT INTO deals(organization_id,name,owner_id,pipeline_id,pipeline_stage_id,value,forecast_category,expected_close) VALUES($1,$2,$3,$4,$5,$6,$7,'2026-12-01')`,[id(1),category,id(11),pipeline,id(100),value,category]);
  }
  const forecast = async (org=id(1),owner:string|null=null) => (await db.query<{category:string;weighted_value:string;total_value:string}>('SELECT * FROM crm_pipeline_forecast($1,$2,$3,$4,$5,$6)',[org,pipeline,'',owner,'2026-12-01','2026-12-31'])).rows;
  const buckets=await forecast();
  assert.equal(Number(buckets.find(r=>r.category==='commit')?.weighted_value),150);
  assert.equal(Number(buckets.find(r=>r.category==='best_case')?.weighted_value),300);
  assert.equal(Number(buckets.find(r=>r.category==='omitted')?.weighted_value),0);
  assert.equal(Number(buckets.find(r=>r.category==='won')?.total_value),1000);
  assert.equal(Number(buckets.find(r=>r.category==='won')?.weighted_value),0,'Won value is not counted twice in open forecast');
  assert.equal((await forecast(id(1),id(20))).length,0,'Owner filters constrain aggregation');
  await db.exec('RESET ROLE');
  await db.exec(readFileSync('supabase/migrations/0081_crm_pipeline_workspace.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0082_crm_pipeline_lifecycle.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0083_crm_opportunity_plans.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0084_crm_pipeline_conflicts.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0085_crm_deal_qualification_rules.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0086_crm_stage_duration_history.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0087_crm_pipeline_saved_views.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0088_crm_stage_configuration_integrity.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0090_crm_deal_card_facts.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0091_crm_approval_revision_decisions.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0092_crm_pipeline_evidence_signals.sql','utf8'));
  await db.exec('SET ROLE authenticated');
  const view={name:'Enterprise close',pipelineId:pipeline,view:'table',filters:{ownerId:id(11)}};
  await db.query('SELECT crm_save_pipeline_views($1,0,$2)',[id(1),JSON.stringify([view])]);
  assert.equal((await db.query<{views:typeof view[]}>('SELECT views FROM crm_pipeline_views')).rows[0].views[0].name,'Enterprise close');
  await assert.rejects(db.query('SELECT crm_save_pipeline_views($1,0,$2)',[id(1),JSON.stringify([view])]),/changed/);
  const durations=(await db.query<{stage_name:string;days:number|null}>('SELECT * FROM crm_deal_stage_durations($1,$2)',[id(1),id(200)])).rows;
  assert.equal(durations[0].stage_name,'Won');assert.equal(durations[0].days,null,'Closed stages do not age indefinitely');
  const cardFacts=await db.query('SELECT * FROM crm_deal_card_facts($1,$2)',[id(1),[id(200)]]);assert.equal(cardFacts.rows.length,1);
  const plan={businessNeed:'Implementation',decisionProcess:'Board review',closePlan:'Agree scope',stakeholders:[{contactId:id(400),role:'decision_maker'}]};
  await db.query('SELECT crm_save_opportunity_plan($1,$2,0,$3)',[id(1),id(200),JSON.stringify(plan)]);
  await assert.rejects(db.query('SELECT crm_save_opportunity_plan($1,$2,0,$3)',[id(1),id(200),JSON.stringify(plan)]),/changed/);
  await assert.rejects(db.query('SELECT crm_save_opportunity_plan($1,$2,1,$3)',[id(1),id(200),JSON.stringify({...plan,stakeholders:[{contactId:id(999),role:'decision_maker'}]})]),/existing contact/);
  // A stage may require explicit buying authority and opportunity qualification.
  const rules=[{...stages[0],requiredFields:['decision_maker','business_need']},...stages.slice(1)];
  await save(pipeline,1,rules);
  await assert.rejects(db.query(`INSERT INTO deals(organization_id,name,owner_id,pipeline_id,pipeline_stage_id) VALUES($1,'Missing buyer',$2,$3,$4)`,[id(1),id(11),pipeline,id(100)]),/stage requirement/);
  await save(pipeline,2,stages);
  const workspace=async(filters:object={})=>(await db.query<{data:{metrics:{openCount:number;openValue:number;weightedValue:number};forecast:{category:string;weighted_value:number}[]}}>('SELECT crm_pipeline_workspace($1,$2,$3) data',[id(1),pipeline,JSON.stringify(filters)])).rows[0].data;
  assert.equal((await workspace()).metrics.openCount,3);
  assert.equal((await workspace()).metrics.openValue,13000);
  assert.equal((await workspace({maxValue:'2000'})).metrics.openValue,3000);
  assert.equal((await workspace({pipelineStageId:id(102)})).metrics.openCount,0);
  assert.equal((await workspace({closeFrom:'2027-01-01'})).metrics.openCount,0);
  assert.equal((await workspace()).forecast.find(r=>r.category==='omitted')?.weighted_value,0);
  await db.query('UPDATE deals SET value=1200 WHERE id=$1',[id(200)]);
  assert.equal((await db.query<{changes:{value:{before:number;after:number}}}>("SELECT changes FROM crm_pipeline_events WHERE deal_id=$1 ORDER BY id DESC LIMIT 1",[id(200)])).rows[0].changes.value.after,1200);
  const lifecycle=(version:number,active=true,def=false,archive=false)=>db.query('SELECT crm_pipeline_lifecycle($1,$2,$3,$4,$5,$6,$7)',[id(1),pipeline,version,'Enterprise opportunities',active,def,archive]);
  await assert.rejects(lifecycle(0),/changed/);
  await assert.rejects(lifecycle(3,false,false,true),/contains deals/);
  await lifecycle(3,false);
  await assert.rejects(db.query(`INSERT INTO deals(organization_id,name,owner_id,pipeline_id,pipeline_stage_id) VALUES($1,'Inactive',$2,$3,$4)`,[id(1),id(11),pipeline,id(100)]),/not accepting/);
  await lifecycle(4,true,true);
  await db.exec(`SELECT set_config('test.member','${id(11)}',false)`);
  await assert.rejects(lifecycle(3),/not permitted/);
  await db.exec(`SELECT set_config('test.member','${id(20)}',false)`);
  assert.equal((await workspace()).metrics.openCount,0,'Workspace aggregates cannot leak cross-tenant data');
  assert.equal((await db.query('SELECT * FROM crm_pipeline_views')).rows.length,0,'Saved views are private to member and organization');
  assert.equal((await forecast()).length,0,'Other tenants cannot read pipeline forecast aggregates');
  assert.equal((await db.query('SELECT * FROM crm_pipelines')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM crm_pipeline_events')).rows.length,0);
  await assert.rejects(db.query(`INSERT INTO deals(organization_id,name,owner_id,pipeline_id,pipeline_stage_id) VALUES($1,'Foreign',$2,$3,$4)`,[id(2),id(20),pipeline,id(100)]),/Pipeline unavailable/);
  await db.query(`INSERT INTO deals(organization_id,name,owner_id,stage) VALUES($1,'Legacy',$2,'qualification')`,[id(2),id(20)]);
 } finally {await db.close();}
});

