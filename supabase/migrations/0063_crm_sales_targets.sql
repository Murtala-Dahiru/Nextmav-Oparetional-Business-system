-- Reuse authoritative Performance targets and immutable business events.
-- No new quota store and no invented target or historical pipeline values.
CREATE OR REPLACE FUNCTION public.crm_sales_targets(p_org uuid,p_from date,p_to date,p_zone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>730 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_zone) THEN RAISE EXCEPTION 'Invalid reporting period' USING ERRCODE='22023';END IF;
 IF NOT public.can_access_module(p_org,'crm') OR NOT public.can_access_module(p_org,'performance') THEN RETURN jsonb_build_object('available',false,'rows','[]'::jsonb,'total',0);END IF;
 RETURN (
 WITH targets AS (
  SELECT t.* FROM performance_targets t WHERE t.organization_id=p_org AND t.subject_type='member'
   AND t.metric IN ('revenue_won','deals_won','leads_qualified','activities_logged') AND t.superseded_by IS NULL
   AND t.period_start<=p_to AND t.period_end>=p_from
 ), limited AS(SELECT * FROM targets ORDER BY period_end,period_start,id LIMIT 100), results AS (
  SELECT t.id,t.subject_id,t.metric,t.period_label,t.period_start,t.period_end,t.currency,t.target_value,
   CASE WHEN t.metric='activities_logged' THEN
    (SELECT count(*) FROM crm_activities a WHERE a.organization_id=p_org AND a.member_id=t.subject_id AND a.created_at>=t.period_start::timestamp AT TIME ZONE p_zone AND a.created_at<(t.period_end+1)::timestamp AT TIME ZONE p_zone)
   WHEN t.metric='leads_qualified' THEN
    (SELECT count(DISTINCT e.entity_id) FROM business_events e WHERE e.organization_id=p_org AND e.subject_member_id=t.subject_id AND e.event_type='lead.qualified' AND e.occurred_at>=t.period_start::timestamp AT TIME ZONE p_zone AND e.occurred_at<(t.period_end+1)::timestamp AT TIME ZONE p_zone)
   ELSE (SELECT coalesce(sum(CASE WHEN t.metric='deals_won' THEN 1 ELSE (e.payload->>'value')::numeric END),0)
    FROM (SELECT DISTINCT ON(entity_id) * FROM business_events WHERE organization_id=p_org AND event_type IN ('deal.won','deal.lost','deal.reopened') AND occurred_at<(t.period_end+1)::timestamp AT TIME ZONE p_zone ORDER BY entity_id,occurred_at DESC,id DESC) e
    WHERE e.event_type='deal.won' AND e.subject_member_id=t.subject_id AND e.occurred_at>=t.period_start::timestamp AT TIME ZONE p_zone
     AND (t.metric='deals_won' OR e.payload->>'currency'=btrim(t.currency))) END AS actual
  FROM limited t
 ) SELECT jsonb_build_object('available',true,'total',(SELECT count(*) FROM targets),'rows',coalesce((SELECT jsonb_agg(r ORDER BY r.period_end,r.id) FROM results r),'[]'::jsonb))
 );
END $$;
REVOKE ALL ON FUNCTION public.crm_sales_targets(uuid,date,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_sales_targets(uuid,date,date,text) TO authenticated;
