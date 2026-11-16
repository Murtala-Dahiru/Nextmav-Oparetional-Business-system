CREATE OR REPLACE FUNCTION public.crm_sales_insights(p_org uuid,p_from date,p_to date,p_zone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>730 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_zone) THEN RAISE EXCEPTION 'Invalid reporting period or timezone' USING ERRCODE='22023';END IF;
 RETURN (
 WITH bounds AS(SELECT p_from::timestamp AT TIME ZONE p_zone AS start_at,(p_to+1)::timestamp AT TIME ZONE p_zone AS end_at,(p_from-(p_to-p_from+1))::timestamp AT TIME ZONE p_zone AS previous_at),
 visible_leads AS(SELECT l.* FROM leads l WHERE l.organization_id=p_org AND l.deleted_at IS NULL AND public.crm_record_visible(l.organization_id,l.owner_id)),
 visible_deals AS(SELECT d.* FROM deals d WHERE d.organization_id=p_org AND d.deleted_at IS NULL AND public.crm_record_visible(d.organization_id,d.owner_id)),
 responses AS(SELECT l.id,l.created_at,l.owner_id,min(coalesce(a.completed_at,a.created_at)) FILTER(WHERE a.activity_type IN ('call','email','meeting') AND (a.due_at IS NULL OR a.completed_at IS NOT NULL) AND coalesce(a.completed_at,a.created_at)>=l.created_at) AS first_at,max(coalesce(a.completed_at,a.created_at)) FILTER(WHERE a.activity_type IN ('call','email','meeting') AND (a.due_at IS NULL OR a.completed_at IS NOT NULL)) AS last_at FROM visible_leads l LEFT JOIN crm_activities a ON a.lead_id=l.id AND a.organization_id=p_org GROUP BY l.id,l.created_at,l.owner_id),
 cohort AS(SELECT l.* FROM visible_leads l,bounds b WHERE l.created_at>=b.start_at AND l.created_at<b.end_at),
 months AS(SELECT generate_series(date_trunc('month',p_from::timestamp),date_trunc('month',p_to::timestamp),interval '1 month') AS month),
 priorities AS(SELECT d.id,d.name,d.expected_close,d.next_step,d.contact_id,d.pipeline_version,
 coalesce((SELECT max(e.created_at) FROM crm_pipeline_events e WHERE e.deal_id=d.id AND e.organization_id=p_org AND e.to_stage_id=d.pipeline_stage_id AND e.from_stage_id IS DISTINCT FROM e.to_stage_id),(SELECT max(e.created_at) FROM deal_stage_events e WHERE e.deal_id=d.id AND e.organization_id=p_org AND e.to_stage=d.stage),d.created_at) AS stage_since,
 coalesce(s.inactivity_days,30) AS threshold,
 (SELECT count(*) FROM crm_pipeline_events e WHERE e.deal_id=d.id AND e.organization_id=p_org AND e.next_close>e.previous_close) AS postponements,
 EXISTS(SELECT 1 FROM crm_stage_approvals a JOIN crm_pipelines p ON p.id=d.pipeline_id WHERE a.deal_id=d.id AND a.organization_id=p_org AND a.status='pending' AND a.deal_version=d.pipeline_version AND a.pipeline_version=p.version) AS pending_approval
 FROM visible_deals d LEFT JOIN crm_pipeline_stages s ON s.id=d.pipeline_stage_id WHERE d.stage NOT IN ('closed_won','closed_lost'))
 SELECT jsonb_build_object(
 'period',jsonb_build_object('from',p_from,'to',p_to),
 'leads',jsonb_build_object('current',(SELECT count(*) FROM cohort),'previous',(SELECT count(*) FROM visible_leads l,bounds b WHERE l.created_at>=b.previous_at AND l.created_at<b.start_at),'converted',(SELECT count(*) FROM cohort WHERE converted_at IS NOT NULL),'qualifiedNow',(SELECT count(*) FROM cohort WHERE status='qualified'),'unassigned',(SELECT count(*) FROM visible_leads WHERE owner_id IS NULL)),
 'cohort',jsonb_build_object('created',(SELECT count(*) FROM cohort),'converted',(SELECT count(*) FROM cohort WHERE converted_at IS NOT NULL),'opportunities',(SELECT count(*) FROM cohort l JOIN visible_deals d ON d.id=l.converted_deal_id),'won',(SELECT count(*) FROM cohort l JOIN visible_deals d ON d.id=l.converted_deal_id WHERE d.stage='closed_won')),
 'responses',jsonb_build_object('medianHours',(SELECT percentile_cont(.5) WITHIN GROUP(ORDER BY extract(epoch FROM(first_at-created_at))/3600) FROM responses WHERE first_at IS NOT NULL),'sampleCount',(SELECT count(*) FROM responses WHERE first_at IS NOT NULL),'unansweredAfter24Hours',(SELECT count(*) FROM responses WHERE first_at IS NULL AND created_at<now()-interval '24 hours'),'quietAfter14Days',(SELECT count(*) FROM responses WHERE last_at<now()-interval '14 days')),
 'sources',coalesce((SELECT jsonb_agg(x) FROM(SELECT coalesce(nullif(btrim(source),''),'Unknown') AS source,count(*) AS leads,count(*) FILTER(WHERE converted_at IS NOT NULL) AS converted FROM cohort GROUP BY 1 ORDER BY count(*) DESC)x),'[]'::jsonb),
 'acquisition',coalesce((SELECT jsonb_agg(x ORDER BY x.period) FROM(SELECT to_char(m.month,'YYYY-MM') AS period,(SELECT count(*) FROM companies c WHERE c.organization_id=p_org AND c.deleted_at IS NULL AND c.created_at AT TIME ZONE p_zone>=greatest(m.month,p_from::timestamp) AND c.created_at AT TIME ZONE p_zone<least(m.month+interval '1 month',(p_to+1)::timestamp)) AS accounts,(SELECT count(*) FROM visible_leads l WHERE l.converted_at AT TIME ZONE p_zone>=greatest(m.month,p_from::timestamp) AND l.converted_at AT TIME ZONE p_zone<least(m.month+interval '1 month',(p_to+1)::timestamp)) AS converted FROM months m)x),'[]'::jsonb),
 'activities',coalesce((SELECT jsonb_agg(x) FROM(SELECT a.activity_type,count(*) AS logged,count(*) FILTER(WHERE a.completed_at IS NOT NULL) AS completed FROM crm_activities a,bounds b WHERE a.organization_id=p_org AND a.created_at>=b.start_at AND a.created_at<b.end_at AND (public.auth_role_in(p_org)<>'sales_staff' OR a.member_id=public.auth_member_id(p_org)) GROUP BY a.activity_type)x),'[]'::jsonb),
 'priorityCount',(SELECT count(*) FROM priorities WHERE next_step='' OR contact_id IS NULL OR postponements>=2 OR pending_approval OR stage_since<now()-threshold*interval '1 day'),
 'priorities',coalesce((SELECT jsonb_agg(x) FROM(SELECT id,name,expected_close,stage_since,threshold,postponements,pending_approval,next_step='' AS missing_next_step,contact_id IS NULL AS missing_contact FROM priorities WHERE next_step='' OR contact_id IS NULL OR postponements>=2 OR pending_approval OR stage_since<now()-threshold*interval '1 day' ORDER BY pending_approval DESC,stage_since,id LIMIT 30)x),'[]'::jsonb)
 ));
END
$$;
REVOKE ALL ON FUNCTION public.crm_sales_insights(uuid,date,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_sales_insights(uuid,date,date,text) TO authenticated;

DO $$ DECLARE t text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH t IN ARRAY ARRAY['crm_pipelines','crm_pipeline_stages','crm_stage_approvals','crm_qualification_frameworks','crm_assignment_settings','crm_capture_forms','crm_account_plans'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);END IF;
  END LOOP;
 END IF;
END $$;
