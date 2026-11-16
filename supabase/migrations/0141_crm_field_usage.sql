CREATE OR REPLACE FUNCTION public.crm_field_usage(p_org uuid,p_field uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f crm_field_definitions%ROWTYPE; records bigint; dependencies jsonb;
BEGIN
 IF NOT coalesce(crm_automation_admin(p_org),false) THEN RAISE EXCEPTION 'CRM administrator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM crm_field_definitions WHERE id=p_field AND organization_id=p_org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Field unavailable' USING ERRCODE='42501'; END IF;
 IF f.object='companies' THEN
  SELECT count(*) INTO records FROM crm_company_field_values WHERE organization_id=p_org AND field_values ? p_field::text;
 ELSE
  IF f.object NOT IN ('leads','contacts','deals') THEN RAISE EXCEPTION 'Unsupported object'; END IF;
  EXECUTE format('SELECT count(*) FROM %I WHERE organization_id=$1 AND custom_values ? $2',f.object) INTO records USING p_org,p_field::text;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'name',name)),'[]'::jsonb) INTO dependencies FROM (
  SELECT 'layout' kind,object name FROM crm_record_layouts WHERE organization_id=p_org AND object=f.object AND (draft::text LIKE '%'||p_field::text||'%' OR published::text LIKE '%'||p_field::text||'%')
  UNION ALL SELECT 'pipeline',name FROM crm_pipeline_stages WHERE organization_id=p_org AND NOT archived AND ('custom:'||p_field::text)=ANY(required_fields||exit_required_fields)
  UNION ALL SELECT 'automation',a.name FROM crm_automations a LEFT JOIN crm_automation_versions v ON v.id=a.published_version WHERE a.organization_id=p_org AND a.status<>'archived' AND (a.draft::text LIKE '%'||p_field::text||'%' OR v.definition::text LIKE '%'||p_field::text||'%')
  UNION ALL SELECT 'shared view',name FROM crm_shared_views WHERE organization_id=p_org AND settings::text LIKE '%'||p_field::text||'%'
  UNION ALL SELECT 'personal lead views','Private saved filters' FROM crm_lead_views WHERE organization_id=p_org AND views::text LIKE '%'||p_field::text||'%'
  UNION ALL SELECT 'personal directory views','Private saved filters' FROM crm_directory_views WHERE organization_id=p_org AND views::text LIKE '%'||p_field::text||'%'
  LIMIT 100
 ) refs;
 RETURN jsonb_build_object('records',records,'dependencies',dependencies);
END $$;
REVOKE ALL ON FUNCTION crm_field_usage(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_field_usage(uuid,uuid) TO authenticated;
