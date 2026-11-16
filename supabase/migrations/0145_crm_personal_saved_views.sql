-- Extend the existing saved-view catalog with private views for every CRM object.
ALTER TABLE crm_shared_views ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false;
DROP POLICY IF EXISTS crm_shared_view_read ON crm_shared_views;
CREATE POLICY crm_shared_view_read ON crm_shared_views FOR SELECT TO authenticated USING(
 can_access_module(organization_id,'crm') AND
 ((is_personal AND owner_id=auth_member_id(organization_id)) OR
  (NOT is_personal AND (department_id IS NULL OR crm_automation_admin(organization_id) OR EXISTS(
    SELECT 1 FROM organization_members m WHERE m.id=auth_member_id(crm_shared_views.organization_id) AND m.department_id=crm_shared_views.department_id))))
);
CREATE OR REPLACE FUNCTION public.crm_shared_view_save(p_org uuid,p_object text,p_name text,p_scope text,p_settings jsonb,p_remove uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth_member_id(p_org); dept uuid; rid uuid; k text; fid text;
BEGIN
 IF actor IS NULL OR NOT coalesce(can_access_module(p_org,'crm'),false) THEN RAISE EXCEPTION 'CRM access required' USING ERRCODE='42501'; END IF;
 SELECT department_id INTO dept FROM organization_members WHERE id=actor AND organization_id=p_org;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text,131));
 IF p_remove IS NOT NULL THEN
  DELETE FROM crm_shared_views WHERE id=p_remove AND organization_id=p_org AND ((is_personal AND owner_id=actor) OR (NOT is_personal AND (crm_automation_admin(p_org) OR (department_id=dept AND auth_role_in(p_org)='manager')))) RETURNING id INTO rid;
  IF rid IS NULL THEN RAISE EXCEPTION 'Shared view unavailable' USING ERRCODE='42501'; END IF;
 ELSE
  IF p_scope IS DISTINCT FROM 'personal' AND NOT crm_automation_admin(p_org) AND NOT coalesce(p_scope='team' AND auth_role_in(p_org)='manager' AND dept IS NOT NULL,false) THEN RAISE EXCEPTION 'Shared view management denied' USING ERRCODE='42501'; END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('organization','team','personal') OR (p_scope='team' AND dept IS NULL) THEN RAISE EXCEPTION 'Choose an available team or organization' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object' OR octet_length(p_settings::text)>16000 OR jsonb_typeof(p_settings->'filters') IS DISTINCT FROM 'object' OR length(coalesce(p_settings->>'search',''))>250 OR coalesce(p_settings->>'sortDir','') NOT IN ('asc','desc') OR coalesce(p_settings->>'sort','') NOT IN ('createdAt','updatedAt','firstName','lastName','status','score','estimatedValue','email','name','industry','employeeCount','annualRevenue','stage','value','probability','expectedClose','closedAt') THEN RAISE EXCEPTION 'Invalid view settings' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_settings->'filters') LOOP
   IF k NOT IN ('custom','source','status','ownerId','campaign','active','unassigned','unconverted','createdSince','awaitingResponse','overdueFollowUp','relationshipRole','companyId','isActive','segment','industry','country','stage','pipelineId','pipelineStageId','forecastCategory','currency','openOnly') OR jsonb_typeof(p_settings->'filters'->k)<>'string' THEN RAISE EXCEPTION 'Unsupported shared filter' USING ERRCODE='22023'; END IF;
   IF k='custom' THEN
    FOR fid IN SELECT jsonb_object_keys((p_settings->'filters'->>k)::jsonb) LOOP
     IF NOT EXISTS(SELECT 1 FROM crm_field_definitions WHERE id::text=fid AND organization_id=p_org AND object=p_object AND NOT archived) THEN RAISE EXCEPTION 'Invalid shared field' USING ERRCODE='22023'; END IF;
    END LOOP;
   END IF;
  END LOOP;
  IF (SELECT count(*) FROM crm_shared_views WHERE organization_id=p_org AND object=p_object AND CASE WHEN p_scope='personal' THEN is_personal AND owner_id=actor ELSE NOT is_personal END)>=(CASE WHEN p_scope='personal' THEN 20 ELSE 100 END) THEN RAISE EXCEPTION 'Shared view limit reached' USING ERRCODE='22023'; END IF;
  INSERT INTO crm_shared_views(organization_id,object,name,department_id,owner_id,settings,is_personal) VALUES(p_org,p_object,p_name,CASE WHEN p_scope='team' THEN dept END,actor,p_settings,p_scope='personal') RETURNING id INTO rid;
 END IF;
 INSERT INTO crm_configuration_audit(organization_id,actor_id,change_type,target_id,after_metadata) VALUES(p_org,actor,CASE WHEN p_remove IS NOT NULL THEN 'view.removed' WHEN p_scope='personal' THEN 'view.personal' ELSE 'view.shared' END,rid,jsonb_build_object('object',p_object));
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION crm_shared_view_save(uuid,text,text,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_shared_view_save(uuid,text,text,text,jsonb,uuid) TO authenticated;

DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('crm_field_usage(uuid,uuid)'::regprocedure) INTO definition;
 EXECUTE replace(definition,'SELECT ''shared view'',name FROM crm_shared_views','SELECT ''saved view'',CASE WHEN is_personal THEN ''Private saved filters'' ELSE name END FROM crm_shared_views');
END $$;
ALTER TABLE crm_list_preferences ADD COLUMN IF NOT EXISTS default_view_id uuid REFERENCES crm_shared_views(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.crm_default_view_save(p_org uuid,p_object text,p_view uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth_member_id(p_org); dept uuid;
BEGIN
 IF actor IS NULL OR NOT coalesce(can_access_module(p_org,'crm'),false) THEN RAISE EXCEPTION 'CRM access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,143));
 SELECT department_id INTO dept FROM organization_members WHERE id=actor AND organization_id=p_org;
 IF p_view IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_shared_views WHERE id=p_view AND organization_id=p_org AND object=p_object AND
  ((is_personal AND owner_id=actor) OR (NOT is_personal AND (department_id IS NULL OR department_id=dept OR crm_automation_admin(p_org))))) THEN
  RAISE EXCEPTION 'Saved view unavailable' USING ERRCODE='42501';
 END IF;
 INSERT INTO crm_list_preferences(organization_id,member_id,object,version,settings,default_view_id)
 VALUES(p_org,actor,p_object,0,'{"hidden":[],"order":[],"density":"comfortable"}',p_view)
 ON CONFLICT(organization_id,member_id,object) DO UPDATE SET default_view_id=excluded.default_view_id;
END $$;
REVOKE ALL ON FUNCTION crm_default_view_save(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_default_view_save(uuid,text,uuid) TO authenticated;
