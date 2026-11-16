-- Extend the existing requirement resolver. The guarded transition, approval,
-- history and optimistic concurrency paths continue to use the same function.
CREATE OR REPLACE FUNCTION public.crm_deal_requirement(p_deal deals,p_field text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE
  WHEN left(p_field,7)='custom:' THEN nullif(p_deal.custom_values->substr(p_field,8),'[]'::jsonb)
  WHEN p_field='decision_maker' THEN (SELECT CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(p.stakeholders) s WHERE s->>'role' IN ('decision_maker','economic_buyer')) THEN 'true'::jsonb ELSE NULL END FROM crm_opportunity_plans p WHERE p.deal_id=p_deal.id AND p.organization_id=p_deal.organization_id)
  WHEN p_field IN ('business_need','decision_process','close_plan') THEN (SELECT to_jsonb(p)->p_field FROM crm_opportunity_plans p WHERE p.deal_id=p_deal.id AND p.organization_id=p_deal.organization_id)
  ELSE to_jsonb(p_deal)->p_field END
$$;
REVOKE ALL ON FUNCTION crm_deal_requirement(deals,text) FROM PUBLIC,authenticated;
DO $$ DECLARE definition text; needle text:='''close_plan'') THEN RAISE EXCEPTION ''Unsupported stage requirement'''; BEGIN
 SELECT pg_get_functiondef('public.crm_save_pipeline(uuid,uuid,integer,text,text,jsonb)'::regprocedure) INTO definition;
 IF position('crm_field_definitions' in definition)=0 THEN
  IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Unexpected pipeline function version'; END IF;
  EXECUTE replace(definition,needle,'''close_plan'') AND NOT EXISTS(SELECT 1 FROM crm_field_definitions WHERE organization_id=p_org AND object=''deals'' AND NOT archived AND ''custom:''||id::text=field) THEN RAISE EXCEPTION ''Unsupported stage requirement''');
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.crm_stage_field_dependency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.archived AND NOT OLD.archived AND EXISTS(SELECT 1 FROM crm_pipeline_stages WHERE organization_id=NEW.organization_id AND NOT archived AND ('custom:'||NEW.id::text)=ANY(required_fields||exit_required_fields)) THEN RAISE EXCEPTION 'Remove this stage requirement before archiving the field' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_stage_field_dependency() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_stage_field_dependency ON crm_field_definitions;
CREATE TRIGGER crm_stage_field_dependency BEFORE UPDATE ON crm_field_definitions FOR EACH ROW EXECUTE FUNCTION crm_stage_field_dependency();
CREATE OR REPLACE FUNCTION public.crm_stage_field_validate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE field text;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(NEW.organization_id::text,131));
 FOREACH field IN ARRAY NEW.required_fields||NEW.exit_required_fields LOOP
  IF left(field,7)='custom:' AND NOT EXISTS(SELECT 1 FROM crm_field_definitions WHERE organization_id=NEW.organization_id AND object='deals' AND NOT archived AND id::text=substr(field,8)) THEN RAISE EXCEPTION 'Custom requirement unavailable' USING ERRCODE='22023'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_stage_field_validate() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_validate_stage_fields ON crm_pipeline_stages;
CREATE TRIGGER crm_validate_stage_fields BEFORE INSERT OR UPDATE OF required_fields,exit_required_fields ON crm_pipeline_stages FOR EACH ROW EXECUTE FUNCTION crm_stage_field_validate();
