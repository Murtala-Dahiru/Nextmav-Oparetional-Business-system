CREATE OR REPLACE FUNCTION public.crm_directory_summary(p_org uuid,p_kind text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_kind='company' THEN jsonb_build_object(
 'total',(SELECT count(*) FROM companies WHERE organization_id=p_org AND deleted_at IS NULL),
 'new_records',(SELECT count(*) FROM companies WHERE organization_id=p_org AND deleted_at IS NULL AND created_at>=now()-interval '30 days'),
 'unassigned',(SELECT count(*) FROM companies WHERE organization_id=p_org AND deleted_at IS NULL AND owner_id IS NULL),
 'with_opportunities',(SELECT count(DISTINCT company_id) FROM deals WHERE organization_id=p_org AND deleted_at IS NULL AND stage NOT IN('closed_won','closed_lost') AND public.crm_record_visible(organization_id,owner_id) AND company_id IN(SELECT id FROM companies WHERE organization_id=p_org AND deleted_at IS NULL))
 ) ELSE jsonb_build_object(
 'total',(SELECT count(*) FROM contacts WHERE organization_id=p_org AND deleted_at IS NULL),
 'active',(SELECT count(*) FROM contacts WHERE organization_id=p_org AND deleted_at IS NULL AND is_active),
 'unassigned',(SELECT count(*) FROM contacts WHERE organization_id=p_org AND deleted_at IS NULL AND owner_id IS NULL),
 'decision_makers',(SELECT count(*) FROM contacts WHERE organization_id=p_org AND deleted_at IS NULL AND is_active AND lower(crm_profile->>'relationshipRole') IN('decision-maker','economic buyer'))
 ) END WHERE public.can_access_module(p_org,'crm');
$$;
REVOKE ALL ON FUNCTION public.crm_directory_summary(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_directory_summary(uuid,text) TO authenticated;
