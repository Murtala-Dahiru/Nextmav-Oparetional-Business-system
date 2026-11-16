-- Organization-defined qualification. No fixed sales methodology is imposed.
CREATE TABLE IF NOT EXISTS crm_qualification_frameworks (
 organization_id uuid NOT NULL PRIMARY KEY REFERENCES organizations(id),
 name text NOT NULL DEFAULT 'Lead qualification' CHECK(length(name) BETWEEN 1 AND 100),
 fields jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(fields)='array' AND jsonb_array_length(fields)<=30),
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES organization_members(id)
);
ALTER TABLE public.crm_qualification_frameworks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_qualification_frameworks FROM anon,authenticated;
GRANT SELECT ON public.crm_qualification_frameworks TO authenticated;
DROP POLICY IF EXISTS qualification_read ON public.crm_qualification_frameworks;
CREATE POLICY qualification_read ON public.crm_qualification_frameworks FOR SELECT TO authenticated USING(public.can_access_module(organization_id,'crm'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS qualification jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS qualification_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS territory text NOT NULL DEFAULT '';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS industry text NOT NULL DEFAULT '';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS service_interest text NOT NULL DEFAULT '';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS campaign text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS crm_qualification_revisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),
 lead_id uuid NOT NULL REFERENCES leads(id),version integer NOT NULL,framework_version integer NOT NULL,
 answers jsonb NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',actor_id uuid REFERENCES organization_members(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(lead_id,version)
);
ALTER TABLE public.crm_qualification_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_qualification_revisions FROM anon,authenticated;
GRANT SELECT ON public.crm_qualification_revisions TO authenticated;
DROP POLICY IF EXISTS qualification_history_read ON public.crm_qualification_revisions;
CREATE POLICY qualification_history_read ON public.crm_qualification_revisions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM leads l WHERE l.id=lead_id AND l.organization_id=crm_qualification_revisions.organization_id AND l.deleted_at IS NULL AND public.crm_record_visible(l.organization_id,l.owner_id)));
CREATE OR REPLACE FUNCTION public.crm_save_qualification_framework(p_org uuid,p_version integer,p_name text,p_fields jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE field jsonb; seen text[]:='{}'; current_version integer;
BEGIN
 IF public.auth_member_id(p_org) IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator') THEN RAISE EXCEPTION 'Qualification configuration not permitted' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-qualification:'||p_org::text,0));
 SELECT version INTO current_version FROM crm_qualification_frameworks WHERE organization_id=p_org;
 IF p_version IS NULL OR coalesce(current_version,0)<>p_version THEN RAISE EXCEPTION 'Qualification framework changed; reload first' USING ERRCODE='40001'; END IF;
 IF p_fields IS NULL OR jsonb_typeof(p_fields)<>'array' OR jsonb_array_length(p_fields) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Define 1 to 30 qualification fields' USING ERRCODE='22023'; END IF;
 FOR field IN SELECT * FROM jsonb_array_elements(p_fields) LOOP
  IF coalesce(field->>'key','')!~'^[a-z][a-z0-9]{0,39}$' OR field->>'key'=ANY(seen) OR coalesce(length(btrim(field->>'label')),0) NOT BETWEEN 1 AND 100 OR coalesce(field->>'type','') NOT IN ('text','number','date','boolean') OR jsonb_typeof(field->'required') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid qualification field' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,field->>'key');
 END LOOP;
 INSERT INTO crm_qualification_frameworks(organization_id,name,fields,updated_by) VALUES(p_org,p_name,p_fields,public.auth_member_id(p_org))
 ON CONFLICT(organization_id) DO UPDATE SET name=excluded.name,fields=excluded.fields,version=crm_qualification_frameworks.version+1,updated_by=excluded.updated_by,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.crm_save_qualification_framework(uuid,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_qualification_framework(uuid,integer,text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.crm_guard_qualification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE framework crm_qualification_frameworks%ROWTYPE; field jsonb; answer jsonb; changed boolean; check_required boolean;
BEGIN
 IF jsonb_typeof(NEW.qualification)<>'object' OR octet_length(NEW.qualification::text)>40000 THEN RAISE EXCEPTION 'Invalid qualification answers' USING ERRCODE='23514'; END IF;
 IF length(NEW.territory)>250 OR length(NEW.industry)>250 OR length(NEW.service_interest)>250 OR length(NEW.campaign)>250 THEN RAISE EXCEPTION 'Lead attribution is too long' USING ERRCODE='23514'; END IF;
 changed:=TG_OP='INSERT';check_required:=true;
 IF TG_OP='UPDATE' THEN
  changed:=ROW(NEW.qualification,NEW.territory,NEW.industry,NEW.service_interest,NEW.campaign) IS DISTINCT FROM ROW(OLD.qualification,OLD.territory,OLD.industry,OLD.service_interest,OLD.campaign);
  check_required:=NEW.qualification IS DISTINCT FROM OLD.qualification OR NEW.status IS DISTINCT FROM OLD.status;
 END IF;
 NEW.qualification_version:=CASE WHEN TG_OP='UPDATE' THEN OLD.qualification_version+CASE WHEN changed THEN 1 ELSE 0 END ELSE 0 END;
 SELECT * INTO framework FROM crm_qualification_frameworks WHERE organization_id=NEW.organization_id;
 IF NOT FOUND THEN IF NEW.qualification<>'{}'::jsonb THEN RAISE EXCEPTION 'Configure qualification before recording answers' USING ERRCODE='23514'; END IF;RETURN NEW;END IF;
 FOR field IN SELECT * FROM jsonb_array_elements(framework.fields) LOOP
  answer:=NEW.qualification->(field->>'key');
  IF answer IS NULL OR answer='null'::jsonb OR answer='""'::jsonb THEN
   IF check_required AND (field->>'required')::boolean AND NEW.status IN ('qualified','proposal','negotiation','won') THEN RAISE EXCEPTION 'Complete qualification field: %',field->>'label' USING ERRCODE='23514';END IF;
  ELSE
   IF (field->>'type'='number' AND jsonb_typeof(answer)<>'number') OR (field->>'type'='boolean' AND jsonb_typeof(answer)<>'boolean') OR (field->>'type' IN ('text','date') AND jsonb_typeof(answer)<>'string') OR length(answer#>>'{}')>4000 THEN RAISE EXCEPTION 'Invalid qualification answer: %',field->>'label' USING ERRCODE='23514';END IF;
   IF field->>'type'='date' THEN
    IF (answer#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Qualification dates must use YYYY-MM-DD' USING ERRCODE='23514';END IF;
    PERFORM (answer#>>'{}')::date;
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_guard_qualification() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_qualification_guard ON public.leads;
CREATE TRIGGER crm_qualification_guard BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.crm_guard_qualification();
CREATE OR REPLACE FUNCTION public.crm_save_lead_qualification(p_org uuid,p_lead uuid,p_version integer,p_framework_version integer,p_answers jsonb,p_metadata jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE lead leads%ROWTYPE; framework crm_qualification_frameworks%ROWTYPE; new_version integer;
BEGIN
 IF public.auth_member_id(p_org) IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'Qualification edit not permitted' USING ERRCODE='42501';END IF;
 SELECT * INTO lead FROM leads WHERE id=p_lead AND organization_id=p_org AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found' USING ERRCODE='P0002';END IF;
 SELECT * INTO framework FROM crm_qualification_frameworks WHERE organization_id=p_org FOR SHARE;
 IF NOT FOUND OR p_framework_version IS NULL OR framework.version<>p_framework_version OR p_version IS NULL OR lead.qualification_version<>p_version THEN RAISE EXCEPTION 'Qualification changed; reload before saving' USING ERRCODE='40001';END IF;
 UPDATE leads SET qualification=p_answers,territory=coalesce(p_metadata->>'territory',''),industry=coalesce(p_metadata->>'industry',''),service_interest=coalesce(p_metadata->>'serviceInterest',''),campaign=coalesce(p_metadata->>'campaign','') WHERE id=lead.id RETURNING qualification_version INTO new_version;
 INSERT INTO crm_qualification_revisions(organization_id,lead_id,version,framework_version,answers,metadata,actor_id) VALUES(p_org,lead.id,new_version,framework.version,p_answers,p_metadata,public.auth_member_id(p_org)) ON CONFLICT(lead_id,version) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.crm_save_lead_qualification(uuid,uuid,integer,integer,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_lead_qualification(uuid,uuid,integer,integer,jsonb,jsonb) TO authenticated;


