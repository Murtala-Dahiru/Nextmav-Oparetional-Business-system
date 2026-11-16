CREATE TABLE IF NOT EXISTS crm_shared_views (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 object text NOT NULL CHECK(object IN ('leads','contacts','companies','deals')),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 60),
 department_id uuid REFERENCES departments(id),owner_id uuid NOT NULL REFERENCES organization_members(id),
 settings jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_shared_view_list ON crm_shared_views(organization_id,object,department_id);
ALTER TABLE crm_shared_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_shared_views FROM PUBLIC,anon,authenticated;
GRANT SELECT ON crm_shared_views TO authenticated;
DROP POLICY IF EXISTS crm_shared_view_read ON crm_shared_views;
CREATE POLICY crm_shared_view_read ON crm_shared_views FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm') AND (department_id IS NULL OR crm_automation_admin(organization_id) OR EXISTS(SELECT 1 FROM organization_members m WHERE m.id=auth_member_id(crm_shared_views.organization_id) AND m.department_id=crm_shared_views.department_id)));
CREATE OR REPLACE FUNCTION public.crm_shared_view_save(p_org uuid,p_object text,p_name text,p_scope text,p_settings jsonb,p_remove uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth_member_id(p_org); dept uuid; rid uuid; k text; fid text;
BEGIN
 IF actor IS NULL OR NOT coalesce(can_access_module(p_org,'crm'),false) THEN RAISE EXCEPTION 'CRM access required' USING ERRCODE='42501'; END IF;
 SELECT department_id INTO dept FROM organization_members WHERE id=actor AND organization_id=p_org;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text,131));
 IF p_remove IS NOT NULL THEN
  DELETE FROM crm_shared_views WHERE id=p_remove AND organization_id=p_org AND (crm_automation_admin(p_org) OR (department_id=dept AND auth_role_in(p_org)='manager')) RETURNING id INTO rid;
  IF rid IS NULL THEN RAISE EXCEPTION 'Shared view unavailable' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT crm_automation_admin(p_org) AND NOT coalesce(p_scope='team' AND auth_role_in(p_org)='manager' AND dept IS NOT NULL,false) THEN RAISE EXCEPTION 'Shared view management denied' USING ERRCODE='42501'; END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('organization','team') OR (p_scope='team' AND dept IS NULL) THEN RAISE EXCEPTION 'Choose an available team or organization' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object' OR octet_length(p_settings::text)>16000 OR jsonb_typeof(p_settings->'filters') IS DISTINCT FROM 'object' OR length(coalesce(p_settings->>'search',''))>250 OR coalesce(p_settings->>'sortDir','') NOT IN ('asc','desc') OR coalesce(p_settings->>'sort','') NOT IN ('createdAt','updatedAt','firstName','lastName','status','score','estimatedValue','email','name','industry','employeeCount','annualRevenue','stage','value','probability','expectedClose','closedAt') THEN RAISE EXCEPTION 'Invalid view settings' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_settings->'filters') LOOP
   IF k NOT IN ('custom','source','status','ownerId','campaign','active','unassigned','unconverted','createdSince','awaitingResponse','overdueFollowUp','relationshipRole','companyId','isActive','segment','industry','country','stage','pipelineId','pipelineStageId','forecastCategory','currency','openOnly') OR jsonb_typeof(p_settings->'filters'->k)<>'string' THEN RAISE EXCEPTION 'Unsupported shared filter' USING ERRCODE='22023'; END IF;
   IF k='custom' THEN
    FOR fid IN SELECT jsonb_object_keys((p_settings->'filters'->>k)::jsonb) LOOP
     IF NOT EXISTS(SELECT 1 FROM crm_field_definitions WHERE id::text=fid AND organization_id=p_org AND object=p_object AND NOT archived) THEN RAISE EXCEPTION 'Invalid shared field' USING ERRCODE='22023'; END IF;
    END LOOP;
   END IF;
  END LOOP;
  IF (SELECT count(*) FROM crm_shared_views WHERE organization_id=p_org AND object=p_object)>=100 THEN RAISE EXCEPTION 'Shared view limit reached' USING ERRCODE='22023'; END IF;
  INSERT INTO crm_shared_views(organization_id,object,name,department_id,owner_id,settings) VALUES(p_org,p_object,p_name,CASE WHEN p_scope='team' THEN dept END,actor,p_settings) RETURNING id INTO rid;
 END IF;
 INSERT INTO crm_configuration_audit(organization_id,actor_id,change_type,target_id,after_metadata) VALUES(p_org,actor,CASE WHEN p_remove IS NULL THEN 'view.shared' ELSE 'view.removed' END,rid,jsonb_build_object('object',p_object));
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION crm_shared_view_save(uuid,text,text,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_shared_view_save(uuid,text,text,text,jsonb,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.crm_view_field_dependency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.archived AND NOT OLD.archived AND EXISTS(SELECT 1 FROM crm_shared_views WHERE organization_id=NEW.organization_id AND object=NEW.object AND (settings->'filters'->>'custom')::jsonb ? NEW.id::text) THEN RAISE EXCEPTION 'Remove dependent shared views before archiving this field' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_view_field_dependency() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_view_field_dependency ON crm_field_definitions;
CREATE TRIGGER crm_view_field_dependency BEFORE UPDATE ON crm_field_definitions FOR EACH ROW EXECUTE FUNCTION crm_view_field_dependency();
