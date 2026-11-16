CREATE TABLE IF NOT EXISTS crm_assignment_settings (
 organization_id uuid NOT NULL PRIMARY KEY REFERENCES organizations(id),version integer NOT NULL DEFAULT 1,
 rules jsonb NOT NULL DEFAULT '[]',fallback_id uuid REFERENCES organization_members(id),
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES organization_members(id)
);
CREATE TABLE IF NOT EXISTS crm_assignment_decisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),
 lead_id uuid NOT NULL REFERENCES leads(id),request_key uuid NOT NULL,owner_id uuid REFERENCES organization_members(id),
 reason text NOT NULL,rule_id text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,request_key)
);
CREATE INDEX IF NOT EXISTS idx_crm_assignment_owner ON crm_assignment_decisions(organization_id,owner_id,id DESC);
ALTER TABLE public.crm_assignment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_assignment_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_assignment_settings,public.crm_assignment_decisions FROM anon,authenticated;
GRANT SELECT ON public.crm_assignment_settings,public.crm_assignment_decisions TO authenticated;
DROP POLICY IF EXISTS assignment_settings_read ON public.crm_assignment_settings;
CREATE POLICY assignment_settings_read ON public.crm_assignment_settings FOR SELECT TO authenticated USING(public.can_access_module(organization_id,'crm'));
DROP POLICY IF EXISTS assignment_decisions_read ON public.crm_assignment_decisions;
CREATE POLICY assignment_decisions_read ON public.crm_assignment_decisions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM leads l WHERE l.id=lead_id AND l.organization_id=crm_assignment_decisions.organization_id AND l.deleted_at IS NULL AND public.crm_record_visible(l.organization_id,l.owner_id)));
CREATE OR REPLACE FUNCTION public.crm_save_assignment_settings(p_org uuid,p_version integer,p_rules jsonb,p_fallback uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; member uuid; version_now integer; ids text[]:='{}';
BEGIN
 IF public.auth_member_id(p_org) IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator') THEN RAISE EXCEPTION 'Assignment configuration not permitted' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-assignment:'||p_org::text,0));
 SELECT version INTO version_now FROM crm_assignment_settings WHERE organization_id=p_org;
 IF p_version IS NULL OR coalesce(version_now,0)<>p_version THEN RAISE EXCEPTION 'Assignment settings changed; reload first' USING ERRCODE='40001';END IF;
 IF p_rules IS NULL OR jsonb_typeof(p_rules)<>'array' OR jsonb_array_length(p_rules)>30 THEN RAISE EXCEPTION 'Invalid assignment rules' USING ERRCODE='22023';END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
  IF coalesce(r->>'id','')='' OR r->>'id'=ANY(ids) OR coalesce(r->>'mode','') NOT IN ('round_robin','territory','industry','service_interest','account_owner','workload') OR jsonb_typeof(r->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(r->'memberIds') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'matches') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'memberIds')>100 OR jsonb_array_length(r->'matches')>100 THEN RAISE EXCEPTION 'Invalid assignment rule' USING ERRCODE='22023';END IF;
  ids:=array_append(ids,r->>'id');
  FOR member IN SELECT jsonb_array_elements_text(r->'memberIds')::uuid LOOP
   IF NOT EXISTS(SELECT 1 FROM organization_members m WHERE m.id=member AND m.organization_id=p_org AND m.is_active AND m.role IN ('owner','administrator','manager','sales_staff')) THEN RAISE EXCEPTION 'Assignment member must be an active salesperson in this organization' USING ERRCODE='22023';END IF;
  END LOOP;
 END LOOP;
 IF p_fallback IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_members m WHERE m.id=p_fallback AND m.organization_id=p_org AND m.is_active AND m.role IN ('owner','administrator','manager','sales_staff')) THEN RAISE EXCEPTION 'Fallback member unavailable' USING ERRCODE='22023';END IF;
 INSERT INTO crm_assignment_settings(organization_id,rules,fallback_id,updated_by) VALUES(p_org,p_rules,p_fallback,public.auth_member_id(p_org)) ON CONFLICT(organization_id) DO UPDATE SET rules=excluded.rules,fallback_id=excluded.fallback_id,version=crm_assignment_settings.version+1,updated_by=excluded.updated_by,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.crm_save_assignment_settings(uuid,integer,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_assignment_settings(uuid,integer,jsonb,uuid) TO authenticated;

-- Internal domain command; only the authenticated wrapper and capture RPC call it.
CREATE OR REPLACE FUNCTION public.crm_assign_lead_internal(p_org uuid,p_lead uuid,p_key uuid,p_reassign boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE lead leads%ROWTYPE; settings crm_assignment_settings%ROWTYPE; prior crm_assignment_decisions%ROWTYPE; r jsonb; chosen uuid; account_owner uuid; reason text:='unassigned'; matched_rule text; attribute text;
BEGIN
 IF p_key IS NULL THEN RAISE EXCEPTION 'Assignment request identity required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-assignment:'||p_org::text,0));
 SELECT * INTO prior FROM crm_assignment_decisions WHERE organization_id=p_org AND request_key=p_key;
 IF FOUND THEN IF prior.lead_id<>p_lead THEN RAISE EXCEPTION 'Assignment retry identity differs' USING ERRCODE='22023';END IF;RETURN jsonb_build_object('ownerId',prior.owner_id,'reason',prior.reason,'replayed',true);END IF;
 SELECT * INTO lead FROM leads WHERE id=p_lead AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found' USING ERRCODE='P0002';END IF;
 SELECT * INTO settings FROM crm_assignment_settings WHERE organization_id=p_org;
 IF lead.owner_id IS NOT NULL AND NOT coalesce(p_reassign,false) THEN chosen:=lead.owner_id;reason:='already_owned';
 ELSE
  -- Prefer explicit relationships. An exact email is evidence only when it
  -- resolves to one existing account; ambiguous matches use the next rule.
  SELECT c.owner_id INTO account_owner FROM contacts ct JOIN companies c ON c.id=ct.company_id AND c.organization_id=ct.organization_id WHERE ct.id=lead.converted_contact_id AND ct.organization_id=p_org AND ct.deleted_at IS NULL AND c.deleted_at IS NULL;
  IF account_owner IS NULL AND nullif(btrim(lead.email),'') IS NOT NULL THEN
   SELECT (array_agg(c.owner_id))[1] INTO account_owner
   FROM contacts ct JOIN companies c ON c.id=ct.company_id AND c.organization_id=ct.organization_id
   WHERE ct.organization_id=p_org AND ct.deleted_at IS NULL AND c.deleted_at IS NULL
    AND lower(btrim(ct.email))=lower(btrim(lead.email))
   HAVING count(DISTINCT c.id)=1;
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(settings.rules,'[]')) LOOP
   IF NOT (r->>'enabled')::boolean THEN CONTINUE;END IF;
   attribute:=CASE r->>'mode' WHEN 'territory' THEN lead.territory WHEN 'industry' THEN lead.industry WHEN 'service_interest' THEN lead.service_interest ELSE '' END;
   IF r->>'mode' IN ('territory','industry','service_interest') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(r->'matches') match WHERE lower(btrim(match))=lower(btrim(attribute)) AND btrim(attribute)<>'') THEN CONTINUE;END IF;
   SELECT m.id INTO chosen FROM organization_members m
   WHERE m.organization_id=p_org AND m.is_active AND m.role IN ('owner','administrator','manager','sales_staff') AND m.id IN(SELECT jsonb_array_elements_text(r->'memberIds')::uuid)
    AND (r->>'mode'<>'account_owner' OR m.id=account_owner)
   ORDER BY CASE WHEN r->>'mode'='workload' THEN (SELECT count(*) FROM leads l WHERE l.organization_id=p_org AND l.owner_id=m.id AND l.deleted_at IS NULL AND l.status NOT IN ('won','lost') AND l.converted_at IS NULL) ELSE 0 END,
    coalesce((SELECT max(a.id) FROM crm_assignment_decisions a WHERE a.organization_id=p_org AND a.owner_id=m.id),0),m.id LIMIT 1;
   IF chosen IS NOT NULL THEN reason:=r->>'mode';matched_rule:=r->>'id';EXIT;END IF;
  END LOOP;
  IF chosen IS NULL THEN SELECT id INTO chosen FROM organization_members WHERE id=settings.fallback_id AND organization_id=p_org AND is_active AND role IN ('owner','administrator','manager','sales_staff');IF chosen IS NOT NULL THEN reason:='fallback';END IF;END IF;
  IF chosen IS DISTINCT FROM lead.owner_id THEN UPDATE leads SET owner_id=chosen WHERE id=lead.id;END IF;
 END IF;
 INSERT INTO crm_assignment_decisions(organization_id,lead_id,request_key,owner_id,reason,rule_id) VALUES(p_org,p_lead,p_key,chosen,reason,matched_rule);
 RETURN jsonb_build_object('ownerId',chosen,'reason',reason,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.crm_assign_lead_internal(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.crm_assign_lead(p_org uuid,p_lead uuid,p_key uuid,p_reassign boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF public.auth_member_id(p_org) IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator','manager') THEN RAISE EXCEPTION 'Lead assignment not permitted' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM leads WHERE id=p_lead AND organization_id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Lead not found' USING ERRCODE='P0002';END IF;
 RETURN public.crm_assign_lead_internal(p_org,p_lead,p_key,p_reassign);
END $$;
REVOKE ALL ON FUNCTION public.crm_assign_lead(uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_assign_lead(uuid,uuid,uuid,boolean) TO authenticated;

