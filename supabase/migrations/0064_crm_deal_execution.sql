ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS deal_team_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS service_items jsonb NOT NULL DEFAULT '[]';
CREATE OR REPLACE FUNCTION public.crm_guard_deal_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb; member uuid;
BEGIN
 IF cardinality(NEW.deal_team_ids)>100 OR jsonb_typeof(NEW.service_items)<>'array' OR jsonb_array_length(NEW.service_items)>100 THEN RAISE EXCEPTION 'Too many deal team members or service items' USING ERRCODE='23514';END IF;
 FOREACH member IN ARRAY NEW.deal_team_ids LOOP
  IF member IS NULL OR NOT EXISTS(SELECT 1 FROM organization_members WHERE id=member AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Deal team member is unavailable' USING ERRCODE='23514';END IF;
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.service_items) LOOP
  IF jsonb_typeof(item)<>'object' OR coalesce(length(btrim(item->>'name')),0) NOT BETWEEN 1 AND 250 OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(item->'unitPrice') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid deal service item' USING ERRCODE='23514';END IF;
  IF (item->>'quantity')::numeric<=0 OR (item->>'quantity')::numeric>1000000 OR (item->>'unitPrice')::numeric<0 OR (item->>'unitPrice')::numeric>100000000000 THEN RAISE EXCEPTION 'Service quantity or price is out of range' USING ERRCODE='23514';END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_deal_execution_guard ON public.deals;
CREATE TRIGGER crm_deal_execution_guard BEFORE INSERT OR UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.crm_guard_deal_execution();
CREATE OR REPLACE FUNCTION public.crm_save_deal_execution(p_org uuid,p_deal uuid,p_version integer,p_details jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d deals%ROWTYPE; version_now integer;
BEGIN
 IF public.auth_member_id(p_org) IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'Deal editing not permitted' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM deals WHERE organization_id=p_org AND id=p_deal AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE='P0002';END IF;
 IF p_version IS NULL OR d.pipeline_version<>p_version THEN RAISE EXCEPTION 'Deal changed. Reload its latest details before saving.' USING ERRCODE='40001';END IF;
 IF p_details IS NULL OR jsonb_typeof(p_details)<>'object' OR octet_length(p_details::text)>100000 OR coalesce(length(p_details->>'nextStep'),0)>4000 OR coalesce(length(p_details->>'competitor'),0)>250 OR coalesce(length(p_details->>'outcomeNotes'),0)>12000 OR coalesce(p_details->>'forecastCategory','') NOT IN ('pipeline','best_case','commit','omitted') OR jsonb_typeof(p_details->'teamIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p_details->'services') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid deal details' USING ERRCODE='22023';END IF;
 UPDATE deals SET next_step=coalesce(p_details->>'nextStep',''),competitor=coalesce(p_details->>'competitor',''),outcome_notes=coalesce(p_details->>'outcomeNotes',''),forecast_category=p_details->>'forecastCategory',deal_team_ids=ARRAY(SELECT jsonb_array_elements_text(p_details->'teamIds')::uuid),service_items=p_details->'services' WHERE id=d.id RETURNING pipeline_version INTO version_now;
 RETURN version_now;
END $$;
REVOKE ALL ON FUNCTION public.crm_save_deal_execution(uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_deal_execution(uuid,uuid,integer,jsonb) TO authenticated;
