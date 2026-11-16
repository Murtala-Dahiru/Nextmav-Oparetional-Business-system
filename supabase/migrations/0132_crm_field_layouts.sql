CREATE TABLE IF NOT EXISTS crm_record_layouts (
 organization_id uuid NOT NULL REFERENCES organizations(id), object text NOT NULL CHECK(object IN ('leads','contacts','companies','deals')),
 version integer NOT NULL DEFAULT 1, draft jsonb NOT NULL DEFAULT '[]', published jsonb, previous jsonb,
 PRIMARY KEY(organization_id,object)
);
ALTER TABLE crm_record_layouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_record_layouts FROM anon,authenticated;
GRANT SELECT ON crm_record_layouts TO authenticated;
DROP POLICY IF EXISTS crm_layout_read ON crm_record_layouts;
CREATE POLICY crm_layout_read ON crm_record_layouts FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm'));

CREATE OR REPLACE FUNCTION public.crm_layout_save(p_org uuid,p_object text,p_version integer,p_action text,p_sections jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing crm_record_layouts%ROWTYPE; part jsonb; fid text; ids text[]:='{}'; section_ids text[]:='{}'; next_version integer;
BEGIN
 IF NOT coalesce(crm_automation_admin(p_org),false) THEN RAISE EXCEPTION 'CRM administrator required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text,131));
 SELECT * INTO existing FROM crm_record_layouts WHERE organization_id=p_org AND object=p_object FOR UPDATE;
 IF p_version IS DISTINCT FROM coalesce(existing.version,0) THEN RAISE EXCEPTION 'Layout changed; reload' USING ERRCODE='PT409'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('draft','publish','revert') THEN RAISE EXCEPTION 'Invalid layout action' USING ERRCODE='22023'; END IF;
 IF p_action='revert' THEN
  IF existing.previous IS NULL THEN RAISE EXCEPTION 'No previous published layout' USING ERRCODE='22023'; END IF;
  p_sections:=existing.previous;
 END IF;
 IF jsonb_typeof(p_sections) IS DISTINCT FROM 'array' OR octet_length(p_sections::text)>32000 THEN RAISE EXCEPTION 'Invalid layout' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_sections)>10 THEN RAISE EXCEPTION 'At most ten sections' USING ERRCODE='22023'; END IF;
 FOR part IN SELECT * FROM jsonb_array_elements(p_sections) LOOP
  IF jsonb_typeof(part) IS DISTINCT FROM 'object' OR length(btrim(coalesce(part->>'title',''))) NOT BETWEEN 1 AND 100 OR coalesce(part->>'columns','') NOT IN ('1','2') OR jsonb_typeof(part->'collapsed') IS DISTINCT FROM 'boolean' OR jsonb_typeof(part->'fields') IS DISTINCT FROM 'array' OR part->>'id' IS NULL THEN RAISE EXCEPTION 'Invalid section' USING ERRCODE='22023'; END IF;
  PERFORM (part->>'id')::uuid;
  IF part->>'id'=ANY(section_ids) THEN RAISE EXCEPTION 'Duplicate section' USING ERRCODE='22023'; END IF;
  section_ids:=array_append(section_ids,part->>'id');
  FOR fid IN SELECT jsonb_array_elements_text(part->'fields') LOOP
   IF fid=ANY(ids) OR NOT EXISTS(SELECT 1 FROM crm_field_definitions WHERE id::text=fid AND organization_id=p_org AND object=p_object AND NOT archived) THEN RAISE EXCEPTION 'Unavailable or duplicate layout field' USING ERRCODE='22023'; END IF;
   ids:=array_append(ids,fid);
  END LOOP;
 END LOOP;
 IF cardinality(ids)>100 THEN RAISE EXCEPTION 'Layout too large' USING ERRCODE='22023'; END IF;
 IF p_action IN ('publish','revert') AND EXISTS(SELECT 1 FROM crm_field_definitions WHERE organization_id=p_org AND object=p_object AND required AND NOT archived AND NOT(id::text=ANY(ids))) THEN RAISE EXCEPTION 'Required fields must be visible' USING ERRCODE='22023'; END IF;
 next_version:=coalesce(existing.version,0)+1;
 INSERT INTO crm_record_layouts(organization_id,object,version,draft,published,previous)
 VALUES(p_org,p_object,next_version,p_sections,CASE WHEN p_action IN ('publish','revert') THEN p_sections ELSE existing.published END,CASE WHEN p_action IN ('publish','revert') THEN existing.published ELSE existing.previous END)
 ON CONFLICT(organization_id,object) DO UPDATE SET version=excluded.version,draft=excluded.draft,published=excluded.published,previous=excluded.previous;
 INSERT INTO crm_configuration_audit(organization_id,actor_id,change_type,target_id,before_metadata,after_metadata)
 VALUES(p_org,auth_member_id(p_org),'layout.'||p_action,p_org,to_jsonb(existing),jsonb_build_object('object',p_object,'version',next_version,'sections',p_sections));
 RETURN next_version;
END $$;
REVOKE ALL ON FUNCTION crm_layout_save(uuid,text,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_layout_save(uuid,text,integer,text,jsonb) TO authenticated;

-- Field retirement is blocked while configuration depends on it. No silent breakage.
CREATE OR REPLACE FUNCTION public.crm_field_dependency_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.archived AND NOT OLD.archived AND EXISTS(
  SELECT 1 FROM crm_record_layouts WHERE organization_id=NEW.organization_id AND object=NEW.object
   AND (draft::text LIKE '%'||NEW.id::text||'%' OR published::text LIKE '%'||NEW.id::text||'%')
 ) THEN RAISE EXCEPTION 'Remove this field from draft and published layouts before archiving' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_field_dependency_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_field_dependencies ON crm_field_definitions;
CREATE TRIGGER crm_field_dependencies BEFORE UPDATE ON crm_field_definitions FOR EACH ROW EXECUTE FUNCTION crm_field_dependency_guard();
