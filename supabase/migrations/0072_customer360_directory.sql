CREATE OR REPLACE FUNCTION public.crm_relationship_directory(p_org uuid,p_kind text,p_ids uuid[])
RETURNS TABLE(id uuid,last_engagement timestamptz,next_action timestamptz,open_opportunities bigint,decision_makers bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH records AS (
 SELECT c.id FROM companies c WHERE p_kind='company' AND c.organization_id=p_org AND c.id=ANY(p_ids) AND c.deleted_at IS NULL AND public.can_access_module(p_org,'crm')
 UNION ALL SELECT c.id FROM contacts c WHERE p_kind='contact' AND c.organization_id=p_org AND c.id=ANY(p_ids) AND c.deleted_at IS NULL AND public.can_access_module(p_org,'crm')
 ), visible_activities AS (
 SELECT a.* FROM crm_activities a WHERE a.organization_id=p_org
 AND (a.deal_id IS NULL OR EXISTS(SELECT 1 FROM deals d WHERE d.id=a.deal_id AND d.organization_id=p_org AND d.deleted_at IS NULL AND public.crm_record_visible(d.organization_id,d.owner_id)))
 AND (a.lead_id IS NULL OR EXISTS(SELECT 1 FROM leads l WHERE l.id=a.lead_id AND l.organization_id=p_org AND l.deleted_at IS NULL AND public.crm_record_visible(l.organization_id,l.owner_id)))
 )
 SELECT r.id,
 (SELECT max(coalesce(a.completed_at,a.created_at)) FROM visible_activities a WHERE (CASE WHEN p_kind='company' THEN a.company_id=r.id ELSE a.contact_id=r.id END) AND a.activity_type IN('call','email','meeting') AND (a.due_at IS NULL OR a.completed_at IS NOT NULL)),
 (SELECT min(a.due_at) FROM visible_activities a WHERE (CASE WHEN p_kind='company' THEN a.company_id=r.id ELSE a.contact_id=r.id END) AND a.completed_at IS NULL),
 (SELECT count(*) FROM deals d WHERE d.organization_id=p_org AND (CASE WHEN p_kind='company' THEN d.company_id=r.id ELSE d.contact_id=r.id END) AND d.deleted_at IS NULL AND d.stage NOT IN('closed_won','closed_lost') AND public.crm_record_visible(d.organization_id,d.owner_id)),
 (SELECT count(*) FROM contacts c WHERE p_kind='company' AND c.organization_id=p_org AND c.company_id=r.id AND c.deleted_at IS NULL AND c.is_active AND lower(c.crm_profile->>'relationshipRole') IN('decision-maker','economic buyer'))
 FROM records r LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.crm_relationship_directory(uuid,text,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_relationship_directory(uuid,text,uuid[]) TO authenticated;
