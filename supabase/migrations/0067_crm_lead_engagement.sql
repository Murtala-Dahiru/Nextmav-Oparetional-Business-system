-- Bounded, read-only lead engagement. RLS remains active; no business rows change.
CREATE OR REPLACE FUNCTION public.crm_lead_engagement(p_org uuid, p_ids uuid[])
RETURNS TABLE(lead_id uuid, last_activity_at timestamptz, first_response_at timestamptz,
 next_follow_up_at timestamptz, overdue_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT l.id, a.last_activity_at, a.first_response_at, a.next_follow_up_at, a.overdue_count
 FROM leads l
 CROSS JOIN LATERAL (
  SELECT
   max(coalesce(completed_at,created_at)) FILTER (WHERE due_at IS NULL OR completed_at IS NOT NULL) AS last_activity_at,
   min(coalesce(completed_at,created_at)) FILTER (WHERE activity_type IN ('call','email','meeting') AND (due_at IS NULL OR completed_at IS NOT NULL)) AS first_response_at,
   min(due_at) FILTER (WHERE due_at IS NOT NULL AND completed_at IS NULL) AS next_follow_up_at,
   count(*) FILTER (WHERE due_at < now() AND completed_at IS NULL) AS overdue_count
  FROM crm_activities WHERE organization_id=p_org AND lead_id=l.id
 ) a
 WHERE l.organization_id=p_org AND l.deleted_at IS NULL
 AND l.id=ANY(p_ids[1:100]) AND public.crm_record_visible(l.organization_id,l.owner_id)
$$;
REVOKE ALL ON FUNCTION public.crm_lead_engagement(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_lead_engagement(uuid,uuid[]) TO authenticated;
