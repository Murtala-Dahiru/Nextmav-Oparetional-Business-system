-- Additive workspace aggregates. All reads retain caller RLS and record scope.
CREATE OR REPLACE FUNCTION public.crm_pipeline_workspace(p_org uuid,p_pipeline uuid,p_filters jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH visible AS (
  SELECT d.*,s.inactivity_days,
    CASE WHEN d.stage='closed_won' THEN 'won' WHEN d.stage='closed_lost' THEN 'lost' ELSE d.forecast_category END bucket
  FROM deals d LEFT JOIN crm_pipeline_stages s ON s.id=d.pipeline_stage_id AND s.organization_id=d.organization_id
  WHERE d.organization_id=p_org AND d.pipeline_id=p_pipeline AND d.deleted_at IS NULL
    AND public.crm_record_visible(d.organization_id,d.owner_id)
    AND (coalesce(p_filters->>'forecastCategory','')='' OR d.forecast_category=p_filters->>'forecastCategory')
    AND (coalesce(p_filters->>'stage','')='' OR (p_filters->>'stage'='open' AND d.stage NOT IN ('closed_won','closed_lost')) OR d.stage::text=p_filters->>'stage')
    AND (coalesce(p_filters->>'search','')='' OR position(lower(p_filters->>'search') in lower(d.name))>0 OR position(lower(p_filters->>'search') in lower(coalesce(d.notes,'')))>0)
    AND (nullif(p_filters->>'ownerId','') IS NULL OR d.owner_id=(p_filters->>'ownerId')::uuid)
    AND (nullif(p_filters->>'teamMemberId','') IS NULL OR (p_filters->>'teamMemberId')::uuid=ANY(d.deal_team_ids))
    AND (nullif(p_filters->>'companyId','') IS NULL OR d.company_id=(p_filters->>'companyId')::uuid)
    AND (nullif(p_filters->>'pipelineStageId','') IS NULL OR d.pipeline_stage_id=(p_filters->>'pipelineStageId')::uuid)
    AND (nullif(p_filters->>'closeFrom','') IS NULL OR d.expected_close>=(p_filters->>'closeFrom')::date)
    AND (nullif(p_filters->>'closeTo','') IS NULL OR d.expected_close<=(p_filters->>'closeTo')::date)
    AND (nullif(p_filters->>'minValue','') IS NULL OR d.value>=(p_filters->>'minValue')::numeric)
    AND (nullif(p_filters->>'maxValue','') IS NULL OR d.value<=(p_filters->>'maxValue')::numeric)
 ), facts AS (
  SELECT v.*,
   (SELECT max(coalesce(a.completed_at,a.created_at)) FROM crm_activities a WHERE a.organization_id=p_org AND a.deal_id=v.id AND a.activity_type IN ('call','email','meeting','video','visit','demo') AND (a.due_at IS NULL OR a.completed_at IS NOT NULL)) last_activity,
   (SELECT max(e.created_at) FROM crm_pipeline_events e WHERE e.organization_id=p_org AND e.deal_id=v.id AND e.to_stage_id=v.pipeline_stage_id AND e.from_stage_id IS DISTINCT FROM e.to_stage_id) stage_since,
   EXISTS(SELECT 1 FROM crm_activities a WHERE a.organization_id=p_org AND a.deal_id=v.id AND a.due_at<now() AND a.completed_at IS NULL) overdue_followup,
   EXISTS(SELECT 1 FROM crm_stage_approvals a JOIN crm_pipelines p ON p.id=v.pipeline_id WHERE a.organization_id=p_org AND a.deal_id=v.id AND a.status='pending' AND a.deal_version=v.pipeline_version AND a.pipeline_version=p.version) awaiting_approval
  FROM visible v WHERE v.stage NOT IN ('closed_won','closed_lost')
 ), risks AS (
  SELECT id,name,value,expected_close,next_step,last_activity,stage_since,
   array_remove(ARRAY[
    CASE WHEN expected_close<coalesce(nullif(p_filters->>'today','')::date,current_date) THEN 'Past expected close' END,
    CASE WHEN btrim(next_step)='' THEN 'Missing next step' END,
    CASE WHEN overdue_followup THEN 'Overdue follow-up' END,
    CASE WHEN awaiting_approval THEN 'Awaiting approval' END,
    CASE WHEN coalesce(last_activity,created_at)<now()-make_interval(days=>coalesce(inactivity_days,30)) THEN 'No recent recorded engagement' END,
    CASE WHEN stage_since<now()-make_interval(days=>coalesce(inactivity_days,30)) THEN 'Long stage duration' END
   ],NULL) signals,inactivity_days
  FROM facts
 ), stages AS (
  SELECT pipeline_stage_id stage_id,count(*) deal_count,sum(value) total_value,sum(CASE WHEN stage IN ('closed_won','closed_lost') THEN 0 ELSE value*probability/100 END) weighted_value
  FROM visible GROUP BY pipeline_stage_id
 ), forecast AS (
  SELECT bucket category,count(*) deal_count,sum(value) total_value,sum(CASE WHEN bucket IN ('won','lost','omitted') THEN 0 ELSE value*probability/100 END) weighted_value
  FROM visible GROUP BY bucket
 ) SELECT jsonb_build_object(
  'stages',coalesce((SELECT jsonb_agg(to_jsonb(stages)) FROM stages),'[]'::jsonb),
  'forecast',coalesce((SELECT jsonb_agg(to_jsonb(forecast)) FROM forecast),'[]'::jsonb),
  'risks',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM risks WHERE cardinality(signals)>0 ORDER BY cardinality(signals) DESC,id LIMIT 50) r),'[]'::jsonb),
  'riskCount',(SELECT count(*) FROM risks WHERE cardinality(signals)>0),
  'periods',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM (SELECT coalesce(to_char(expected_close,'YYYY-MM'),'Unscheduled') period,count(*) deal_count,sum(value) total_value,sum(value*probability/100) weighted_value FROM visible WHERE stage NOT IN ('closed_won','closed_lost') AND forecast_category<>'omitted' GROUP BY 1 ORDER BY 1) m),'[]'::jsonb),
  'owners',coalesce((SELECT jsonb_agg(to_jsonb(o)) FROM (SELECT owner_id,count(*) deal_count,sum(value) total_value,sum(value*probability/100) weighted_value FROM visible WHERE stage NOT IN ('closed_won','closed_lost') AND forecast_category<>'omitted' GROUP BY owner_id ORDER BY sum(value) DESC) o),'[]'::jsonb),
  'lossReasons',coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM (SELECT coalesce(nullif(btrim(lost_reason),''),'Not recorded') reason,count(*) deal_count FROM visible WHERE stage='closed_lost' GROUP BY 1 ORDER BY count(*) DESC LIMIT 20) l),'[]'::jsonb),
  'averageWonCycleDays',(SELECT round(avg(extract(epoch FROM (closed_at-created_at))/86400),1) FROM visible WHERE stage='closed_won' AND closed_at>=created_at),
  'stageConversion',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM (
   SELECT source.id stage_id,count(DISTINCT e.deal_id) departed_deals,count(DISTINCT e.deal_id) FILTER(WHERE target.position>source.position AND target.canonical_stage<>'closed_lost') advanced_deals
   FROM crm_pipeline_events e JOIN visible v ON v.id=e.deal_id JOIN crm_pipeline_stages source ON source.id=e.from_stage_id JOIN crm_pipeline_stages target ON target.id=e.to_stage_id
   WHERE e.organization_id=p_org AND e.from_stage_id IS DISTINCT FROM e.to_stage_id AND source.canonical_stage NOT IN ('closed_won','closed_lost')
   GROUP BY source.id
  ) c),'[]'::jsonb),
  'stageAging',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT pipeline_stage_id stage_id,count(*) deal_count,count(stage_since) known_entry_count,round(avg(extract(epoch FROM (now()-stage_since))/86400),1) average_days FROM facts GROUP BY pipeline_stage_id) a),'[]'::jsonb),
  'metrics',(SELECT jsonb_build_object(
   'openCount',count(*) FILTER(WHERE stage NOT IN ('closed_won','closed_lost')),
   'openValue',coalesce(sum(value) FILTER(WHERE stage NOT IN ('closed_won','closed_lost')),0),
   'weightedValue',coalesce(sum(value*probability/100) FILTER(WHERE stage NOT IN ('closed_won','closed_lost')),0),
   'closingSoon',count(*) FILTER(WHERE stage NOT IN ('closed_won','closed_lost') AND expected_close BETWEEN coalesce(nullif(p_filters->>'today','')::date,current_date) AND coalesce(nullif(p_filters->>'today','')::date,current_date)+14),
   'pastClose',count(*) FILTER(WHERE stage NOT IN ('closed_won','closed_lost') AND expected_close<coalesce(nullif(p_filters->>'today','')::date,current_date)),
   'missingNextStep',count(*) FILTER(WHERE stage NOT IN ('closed_won','closed_lost') AND btrim(next_step)=''),
   'averageAge',coalesce(round(avg(extract(epoch FROM (now()-created_at))/86400) FILTER(WHERE stage NOT IN ('closed_won','closed_lost'))),0),
   'wonCount',count(*) FILTER(WHERE stage='closed_won'),
   'lostCount',count(*) FILTER(WHERE stage='closed_lost'),
   'wonValue',coalesce(sum(value) FILTER(WHERE stage='closed_won'),0)
  ) FROM visible)
 )
$$;
REVOKE ALL ON FUNCTION public.crm_pipeline_workspace(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_workspace(uuid,uuid,jsonb) TO authenticated;
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_close ON deals(organization_id,pipeline_id,expected_close,id) WHERE deleted_at IS NULL;

-- Preserve configured-stage movements even when the legacy reporting stage is unchanged.
ALTER TABLE crm_pipeline_events ADD COLUMN IF NOT EXISTS changes jsonb NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION public.crm_record_pipeline_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changeset jsonb:='{}'; field text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.pipeline_id IS NOT NULL THEN INSERT INTO crm_pipeline_events(organization_id,deal_id,to_stage_id,next_close,member_id,changes) VALUES(NEW.organization_id,NEW.id,NEW.pipeline_stage_id,NEW.expected_close,public.auth_member_id(NEW.organization_id),jsonb_build_object('created',true)); END IF;
 ELSE
  FOREACH field IN ARRAY ARRAY['value','probability','owner_id','expected_close','pipeline_stage_id','stage','closed_at','lost_reason','outcome_notes','next_step','forecast_category'] LOOP
   IF to_jsonb(NEW)->field IS DISTINCT FROM to_jsonb(OLD)->field THEN
    changeset:=changeset||jsonb_build_object(field,jsonb_build_object('before',to_jsonb(OLD)->field,'after',to_jsonb(NEW)->field));
   END IF;
  END LOOP;
  IF changeset<>'{}'::jsonb THEN
   INSERT INTO crm_pipeline_events(organization_id,deal_id,from_stage_id,to_stage_id,previous_close,next_close,member_id,changes)
   VALUES(NEW.organization_id,NEW.id,OLD.pipeline_stage_id,NEW.pipeline_stage_id,OLD.expected_close,NEW.expected_close,public.auth_member_id(NEW.organization_id),changeset);
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_record_pipeline_event() FROM PUBLIC;
