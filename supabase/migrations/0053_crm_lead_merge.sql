-- Controlled lead deduplication. Soft retirement retains source attribution and history.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES leads(id);
CREATE OR REPLACE FUNCTION public.crm_guard_merge_pointer()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.merged_into_id IS NOT NULL THEN
    IF NEW.merged_into_id=NEW.id OR NEW.deleted_at IS NULL OR NOT EXISTS (
      SELECT 1 FROM leads target WHERE target.id=NEW.merged_into_id AND target.organization_id=NEW.organization_id
    ) THEN RAISE EXCEPTION 'Invalid merged lead relationship' USING ERRCODE='23514'; END IF;
  END IF;
  IF current_user IN ('authenticated','anon') THEN
    IF TG_OP='INSERT' THEN
      IF NEW.merged_into_id IS NOT NULL THEN RAISE EXCEPTION 'Use the audited merge command' USING ERRCODE='42501'; END IF;
    ELSIF NEW.merged_into_id IS DISTINCT FROM OLD.merged_into_id THEN
      RAISE EXCEPTION 'Use the audited merge command' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_guard_merge_pointer() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_merge_pointer_boundary ON public.leads;
CREATE TRIGGER crm_merge_pointer_boundary BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.crm_guard_merge_pointer();
CREATE TABLE IF NOT EXISTS crm_lead_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  request_key uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES leads(id),
  target_id uuid NOT NULL REFERENCES leads(id),
  source_snapshot jsonb NOT NULL,
  target_snapshot jsonb NOT NULL,
  choices jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES organization_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,request_key),
  CHECK(source_id<>target_id)
);
ALTER TABLE public.crm_lead_merges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_merge_read ON public.crm_lead_merges;
CREATE POLICY crm_merge_read ON public.crm_lead_merges FOR SELECT TO authenticated USING (
  public.auth_role_in(organization_id) IN ('owner','administrator'));
REVOKE ALL ON public.crm_lead_merges FROM authenticated,anon;
GRANT SELECT ON public.crm_lead_merges TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_lead_duplicates(p_org uuid,p_lead uuid)
RETURNS TABLE(id uuid,first_name text,last_name text,company_name text,email text,phone text,confidence text,reasons text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  WITH origin AS (SELECT l.* FROM leads l WHERE l.id=p_lead AND l.organization_id=p_org AND l.deleted_at IS NULL
    AND public.crm_record_visible(l.organization_id,l.owner_id)), matches AS (
    SELECT candidate.*,array_remove(ARRAY[
      CASE WHEN nullif(btrim(origin.email::text),'') IS NOT NULL AND lower(btrim(candidate.email::text))=lower(btrim(origin.email::text)) THEN 'Exact normalized email' END,
      CASE WHEN length(regexp_replace(coalesce(origin.phone,''),'[^0-9]','','g'))>=7 AND regexp_replace(candidate.phone,'[^0-9]','','g')=regexp_replace(origin.phone,'[^0-9]','','g') THEN 'Exact normalized phone' END,
      CASE WHEN nullif(public.crm_company_match_key(origin.company_name),'') IS NOT NULL AND public.crm_company_match_key(candidate.company_name)=public.crm_company_match_key(origin.company_name) THEN 'Possible company match' END,
      CASE WHEN position('@' IN origin.email::text)>1 AND split_part(lower(btrim(origin.email::text)),'@',2) NOT IN ('gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','aol.com','proton.me','protonmail.com')
        AND split_part(lower(btrim(origin.email::text)),'@',2)=split_part(lower(btrim(candidate.email::text)),'@',2) THEN 'Possible email-domain match' END,
      CASE WHEN origin.converted_contact_id IS NOT NULL AND candidate.converted_contact_id=origin.converted_contact_id THEN 'Same linked contact' END
    ],NULL) AS match_reasons
    FROM leads candidate CROSS JOIN origin WHERE candidate.id<>origin.id AND candidate.organization_id=p_org AND candidate.deleted_at IS NULL
      AND public.crm_record_visible(candidate.organization_id,candidate.owner_id)
  ) SELECT m.id,m.first_name,m.last_name,m.company_name,m.email::text,m.phone,
    CASE WHEN 'Exact normalized email'=ANY(match_reasons) OR 'Exact normalized phone'=ANY(match_reasons) OR 'Same linked contact'=ANY(match_reasons) THEN 'exact' ELSE 'possible' END,
    match_reasons FROM matches m WHERE cardinality(match_reasons)>0 ORDER BY cardinality(match_reasons) DESC,m.id LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.crm_lead_duplicates(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_lead_duplicates(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_merge_leads(p_org uuid,p_source uuid,p_target uuid,p_source_updated timestamptz,p_target_updated timestamptz,p_choices jsonb,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE src leads%ROWTYPE; dst leads%ROWTYPE; prior crm_lead_merges%ROWTYPE; actor uuid; field text; chosen text; merged jsonb;
BEGIN
  actor:=public.auth_member_id(p_org);
  IF actor IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator') THEN
    RAISE EXCEPTION 'Lead merging requires CRM deletion permission' USING ERRCODE='42501';
  END IF;
  IF p_source=p_target OR p_request IS NULL OR p_choices IS NULL OR jsonb_typeof(p_choices)<>'object' THEN
    RAISE EXCEPTION 'Invalid merge request' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-convert:'||p_org::text,0));
  SELECT * INTO prior FROM crm_lead_merges WHERE organization_id=p_org AND request_key=p_request;
  IF FOUND THEN
    IF prior.source_id<>p_source OR prior.target_id<>p_target THEN RAISE EXCEPTION 'Merge retry does not match' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('id',prior.id,'target_id',prior.target_id,'already_merged',true);
  END IF;
  PERFORM 1 FROM leads WHERE id IN (p_source,p_target) AND organization_id=p_org ORDER BY id FOR UPDATE;
  SELECT * INTO src FROM leads WHERE id=p_source AND organization_id=p_org AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source lead not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO dst FROM leads WHERE id=p_target AND organization_id=p_org AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target lead not found' USING ERRCODE='P0002'; END IF;
  IF src.updated_at IS DISTINCT FROM p_source_updated OR dst.updated_at IS DISTINCT FROM p_target_updated THEN
    RAISE EXCEPTION 'A lead changed; reload and review the merge again' USING ERRCODE='40001';
  END IF;
  IF src.converted_at IS NOT NULL OR dst.converted_at IS NOT NULL OR src.converted_contact_id IS NOT NULL OR dst.converted_contact_id IS NOT NULL THEN
    RAISE EXCEPTION 'Converted leads must be reviewed through their customer relationships' USING ERRCODE='22023';
  END IF;
  merged:=to_jsonb(dst);
  -- Every conflict requires an explicit source/target selection, including ownership and source.
  FOREACH field IN ARRAY ARRAY['first_name','last_name','email','phone','company_name','job_title','source','status','score','estimated_value','owner_id'] LOOP
    chosen:=p_choices->>field;
    IF chosen IS NULL OR chosen NOT IN ('source','target') THEN RAISE EXCEPTION 'Choose a value for every merge field' USING ERRCODE='22023'; END IF;
    IF chosen='source' THEN merged:=jsonb_set(merged,ARRAY[field],coalesce(to_jsonb(src)->field,'null'::jsonb)); END IF;
  END LOOP;
  IF coalesce(merged->>'first_name','')='' AND coalesce(merged->>'last_name','')='' AND coalesce(merged->>'company_name','')='' THEN
    RAISE EXCEPTION 'Merged lead needs an identity' USING ERRCODE='22023';
  END IF;
  IF nullif(merged->>'owner_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_members WHERE id=(merged->>'owner_id')::uuid AND organization_id=p_org) THEN
    RAISE EXCEPTION 'Lead owner must belong to this organization' USING ERRCODE='22023';
  END IF;
  UPDATE leads SET first_name=merged->>'first_name',last_name=merged->>'last_name',email=merged->>'email',phone=merged->>'phone',
    company_name=merged->>'company_name',job_title=merged->>'job_title',source=merged->>'source',status=(merged->>'status')::lead_status,
    score=(merged->>'score')::int,estimated_value=(merged->>'estimated_value')::numeric,owner_id=(merged->>'owner_id')::uuid,
    notes=concat_ws(E'\n\n',nullif(dst.notes,''),CASE WHEN src.notes<>dst.notes THEN nullif(src.notes,'') END),updated_at=now()
    WHERE id=p_target AND organization_id=p_org;
  UPDATE crm_activities SET lead_id=p_target WHERE lead_id=p_source AND organization_id=p_org;
  UPDATE partner_leads SET lead_id=p_target WHERE lead_id=p_source AND organization_id=p_org;
  UPDATE leads SET deleted_at=now(),merged_into_id=p_target,updated_at=now() WHERE id=p_source AND organization_id=p_org;
  INSERT INTO crm_lead_merges(organization_id,request_key,source_id,target_id,source_snapshot,target_snapshot,choices,actor_id)
    VALUES(p_org,p_request,p_source,p_target,to_jsonb(src),to_jsonb(dst),p_choices,actor) RETURNING * INTO prior;
  RETURN jsonb_build_object('id',prior.id,'target_id',p_target,'already_merged',false);
END $$;
REVOKE ALL ON FUNCTION public.crm_merge_leads(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_merge_leads(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,uuid) TO authenticated;
