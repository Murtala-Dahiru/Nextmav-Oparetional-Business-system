-- Attachment bytes keep their immutable object paths. Read access follows
-- an audited lead merge to the surviving record, including successive merges.
CREATE OR REPLACE FUNCTION public.crm_file_record_visible(p_org uuid,p_kind text,p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_kind='lead' THEN EXISTS(
  WITH RECURSIVE chain AS(
   SELECT id,merged_into_id,owner_id,deleted_at FROM leads WHERE id=p_id AND organization_id=p_org
   UNION SELECT l.id,l.merged_into_id,l.owner_id,l.deleted_at FROM leads l JOIN chain c ON l.id=c.merged_into_id WHERE l.organization_id=p_org
  ) SELECT 1 FROM chain WHERE deleted_at IS NULL AND public.crm_record_visible(p_org,owner_id)
 ) ELSE public.crm_entity_visible(p_org,p_kind,p_id) END
$$;
REVOKE ALL ON FUNCTION public.crm_file_record_visible(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_file_record_visible(uuid,text,uuid) TO authenticated;
DROP POLICY IF EXISTS crm_storage_read ON storage.objects;
CREATE POLICY crm_storage_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'crm-files' OR public.crm_file_record_visible(public.storage_org_id(name),split_part(name,'/',2),public.storage_org_id(split_part(name,'/',3))));
DROP POLICY IF EXISTS crm_storage_delete ON storage.objects;
CREATE POLICY crm_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'crm-files' OR public.crm_file_record_visible(public.storage_org_id(name),split_part(name,'/',2),public.storage_org_id(split_part(name,'/',3))));

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
  FOREACH field IN ARRAY ARRAY['first_name','last_name','email','phone','company_name','job_title','source','status','score','estimated_value','owner_id','qualification','territory','industry','service_interest','campaign'] LOOP
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
    qualification=coalesce(merged->'qualification','{}'::jsonb),territory=coalesce(merged->>'territory',''),industry=coalesce(merged->>'industry',''),service_interest=coalesce(merged->>'service_interest',''),campaign=coalesce(merged->>'campaign',''),
    notes=concat_ws(E'\n\n',nullif(dst.notes,''),CASE WHEN src.notes<>dst.notes THEN nullif(src.notes,'') END),updated_at=now()
    WHERE id=p_target AND organization_id=p_org;
  UPDATE crm_activities SET lead_id=p_target WHERE lead_id=p_source AND organization_id=p_org;
  UPDATE partner_leads SET lead_id=p_target WHERE lead_id=p_source AND organization_id=p_org;
  UPDATE crm_capture_submissions SET lead_id=p_target WHERE lead_id=p_source AND organization_id=p_org;
  UPDATE crm_files SET record_id=p_target WHERE record_kind='lead' AND record_id=p_source AND organization_id=p_org;
  UPDATE leads SET deleted_at=now(),merged_into_id=p_target,updated_at=now() WHERE id=p_source AND organization_id=p_org;
  INSERT INTO crm_lead_merges(organization_id,request_key,source_id,target_id,source_snapshot,target_snapshot,choices,actor_id)
    VALUES(p_org,p_request,p_source,p_target,to_jsonb(src),to_jsonb(dst),p_choices,actor) RETURNING * INTO prior;
  RETURN jsonb_build_object('id',prior.id,'target_id',p_target,'already_merged',false);
END $$;
REVOKE ALL ON FUNCTION public.crm_merge_leads(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_merge_leads(uuid,uuid,uuid,timestamptz,timestamptz,jsonb,uuid) TO authenticated;

