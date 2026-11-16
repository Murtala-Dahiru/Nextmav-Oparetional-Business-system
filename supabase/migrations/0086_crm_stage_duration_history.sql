CREATE OR REPLACE FUNCTION public.crm_deal_stage_durations(p_org uuid,p_deal uuid)
RETURNS TABLE(stage_name text,entered_at timestamptz,exited_at timestamptz,days numeric,is_current boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH movements AS (
  SELECT e.id,e.to_stage_id,e.created_at,lead(e.created_at) OVER(ORDER BY e.created_at,e.id) next_entry
  FROM crm_pipeline_events e JOIN deals d ON d.id=e.deal_id AND d.organization_id=e.organization_id
  WHERE e.organization_id=p_org AND e.deal_id=p_deal AND d.deleted_at IS NULL AND crm_record_visible(d.organization_id,d.owner_id)
    AND (e.from_stage_id IS DISTINCT FROM e.to_stage_id)
 ) SELECT s.name,m.created_at,m.next_entry,
  CASE WHEN s.canonical_stage IN ('closed_won','closed_lost') AND m.next_entry IS NULL THEN NULL ELSE round(extract(epoch FROM (coalesce(m.next_entry,now())-m.created_at))/86400,1) END,
  m.next_entry IS NULL
 FROM movements m JOIN crm_pipeline_stages s ON s.id=m.to_stage_id AND s.organization_id=p_org
 ORDER BY m.created_at DESC,m.id DESC LIMIT 100
$$;
REVOKE ALL ON FUNCTION public.crm_deal_stage_durations(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_deal_stage_durations(uuid,uuid) TO authenticated;
