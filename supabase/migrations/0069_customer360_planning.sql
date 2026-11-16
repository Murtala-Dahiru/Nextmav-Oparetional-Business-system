-- Add structured objectives, stakeholders and actions without replacing legacy text.
ALTER TABLE public.crm_account_plans ADD COLUMN IF NOT EXISTS items jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items)='array' AND octet_length(items::text)<=500000);
CREATE OR REPLACE FUNCTION public.crm_save_account_plan(
  p_org uuid,p_company uuid,p_version integer,p_plan jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; existing_version integer; saved public.crm_account_plans%ROWTYPE; owner_member uuid; item jsonb;
BEGIN
  actor := public.auth_member_id(p_org);
  IF actor IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN
    RAISE EXCEPTION 'Account plan editing is not permitted' USING ERRCODE='42501';
  END IF;
  IF p_version IS NULL OR p_version < 0 OR p_plan IS NULL OR jsonb_typeof(p_plan)<>'object' THEN
    RAISE EXCEPTION 'Invalid account plan' USING ERRCODE='22023';
  END IF;
  -- Lock the parent even for first insert, serializing competing first saves.
  PERFORM 1 FROM public.companies WHERE id=p_company AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company not found' USING ERRCODE='P0002'; END IF;
  SELECT version INTO existing_version FROM public.crm_account_plans WHERE company_id=p_company AND organization_id=p_org;
  IF coalesce(existing_version,0)<>p_version THEN
    RAISE EXCEPTION 'Account plan changed; reload before saving' USING ERRCODE='40001';
  END IF;
  owner_member := nullif(p_plan->>'ownerId','')::uuid;
  IF owner_member IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members WHERE id=owner_member AND organization_id=p_org) THEN
    RAISE EXCEPTION 'Owner must belong to this organization' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(coalesce(p_plan->'items','[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_plan->'items','[]'::jsonb)) > 100 THEN
    RAISE EXCEPTION 'Invalid structured plan' USING ERRCODE='22023'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'items','[]'::jsonb)) LOOP
    IF item->>'kind' NOT IN ('objective','action','stakeholder') OR coalesce(length(item->>'title'),0) NOT BETWEEN 1 AND 250
      OR item->>'status' NOT IN ('planned','in_progress','completed','blocked') OR item->>'priority' NOT IN ('low','normal','high')
      OR (item->>'progress')::integer NOT BETWEEN 0 AND 100 OR length(coalesce(item->>'description','')) > 4000 THEN
      RAISE EXCEPTION 'Invalid plan item' USING ERRCODE='22023'; END IF;
    IF nullif(item->>'ownerId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_members WHERE id=(item->>'ownerId')::uuid AND organization_id=p_org) THEN
      RAISE EXCEPTION 'Item owner must belong to this organization' USING ERRCODE='22023'; END IF;
    IF nullif(item->>'contactId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=(item->>'contactId')::uuid AND organization_id=p_org AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Stakeholder unavailable' USING ERRCODE='22023'; END IF;
    IF nullif(item->>'dealId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM deals WHERE id=(item->>'dealId')::uuid AND organization_id=p_org AND company_id=p_company AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id)) THEN
      RAISE EXCEPTION 'Opportunity unavailable for this account' USING ERRCODE='22023'; END IF;
  END LOOP;
  INSERT INTO crm_account_plans(company_id,organization_id,objectives,stakeholders,opportunities,risks,actions,owner_id,review_date,version,updated_by,items)
  VALUES(p_company,p_org,coalesce(p_plan->>'objectives',''),coalesce(p_plan->>'stakeholders',''),coalesce(p_plan->>'opportunities',''),coalesce(p_plan->>'risks',''),coalesce(p_plan->>'actions',''),owner_member,nullif(p_plan->>'reviewDate','')::date,p_version+1,actor,coalesce(p_plan->'items','[]'::jsonb))
  ON CONFLICT(company_id) DO UPDATE SET objectives=excluded.objectives,stakeholders=excluded.stakeholders,
    opportunities=excluded.opportunities,risks=excluded.risks,actions=excluded.actions,owner_id=excluded.owner_id,
    items=excluded.items,review_date=excluded.review_date,version=excluded.version,updated_by=actor,updated_at=now()
  RETURNING * INTO saved;
  INSERT INTO crm_account_plan_revisions(company_id,organization_id,version,snapshot,changed_by)
  VALUES(p_company,p_org,saved.version,to_jsonb(saved),actor);
  RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.crm_save_account_plan(uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_account_plan(uuid,uuid,integer,jsonb) TO authenticated;
