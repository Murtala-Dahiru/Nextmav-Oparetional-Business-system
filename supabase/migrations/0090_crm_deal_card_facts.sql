CREATE OR REPLACE FUNCTION public.crm_deal_card_facts(p_org uuid,p_ids uuid[])
RETURNS TABLE(id uuid,last_activity_at timestamptz,stage_entered_at timestamptz,overdue_followup boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT d.id,
 (SELECT max(coalesce(a.completed_at,a.created_at)) FROM crm_activities a WHERE a.organization_id=p_org AND a.deal_id=d.id AND a.activity_type IN ('call','email','meeting','video','visit','demo') AND (a.due_at IS NULL OR a.completed_at IS NOT NULL)),
 (SELECT max(e.created_at) FROM crm_pipeline_events e WHERE e.organization_id=p_org AND e.deal_id=d.id AND e.to_stage_id=d.pipeline_stage_id AND e.from_stage_id IS DISTINCT FROM e.to_stage_id),
 EXISTS(SELECT 1 FROM crm_activities a WHERE a.organization_id=p_org AND a.deal_id=d.id AND a.due_at<now() AND a.completed_at IS NULL)
 FROM deals d WHERE d.organization_id=p_org AND d.id=ANY(p_ids) AND cardinality(p_ids)<=100 AND d.deleted_at IS NULL AND crm_record_visible(d.organization_id,d.owner_id)
$$;
REVOKE ALL ON FUNCTION public.crm_deal_card_facts(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_deal_card_facts(uuid,uuid[]) TO authenticated;
