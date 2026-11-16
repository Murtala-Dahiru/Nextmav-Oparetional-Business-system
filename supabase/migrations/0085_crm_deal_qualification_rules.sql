-- Resolve explicit opportunity evidence for the same entry/exit validator.
CREATE OR REPLACE FUNCTION public.crm_deal_requirement(p_deal deals,p_field text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE
  WHEN p_field='decision_maker' THEN (SELECT CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(p.stakeholders) s WHERE s->>'role' IN ('decision_maker','economic_buyer')) THEN 'true'::jsonb ELSE NULL END FROM crm_opportunity_plans p WHERE p.deal_id=p_deal.id AND p.organization_id=p_deal.organization_id)
  WHEN p_field IN ('business_need','decision_process','close_plan') THEN (SELECT to_jsonb(p)->p_field FROM crm_opportunity_plans p WHERE p.deal_id=p_deal.id AND p.organization_id=p_deal.organization_id)
  ELSE to_jsonb(p_deal)->p_field END
$$;
REVOKE ALL ON FUNCTION public.crm_deal_requirement(deals,text) FROM PUBLIC,authenticated;

DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.crm_enforce_pipeline_stage()'::regprocedure) INTO definition;
 definition:=replace(definition,'value:=to_jsonb(NEW)->field;','value:=public.crm_deal_requirement(NEW,field);');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.crm_save_pipeline(uuid,uuid,integer,text,text,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,'''competitor'',''outcome_notes'') THEN','''competitor'',''outcome_notes'',''decision_maker'',''business_need'',''decision_process'',''close_plan'') THEN');
 EXECUTE definition;
END $$;

CREATE OR REPLACE FUNCTION public.crm_opportunity_plan_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 -- Invalidate pending approvals, and enforce current-stage evidence after plan edits.
 UPDATE deals SET updated_at=now() WHERE id=NEW.deal_id AND organization_id=NEW.organization_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_opportunity_plan_revision() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_opportunity_plan_revision ON crm_opportunity_plans;
CREATE TRIGGER crm_opportunity_plan_revision AFTER INSERT OR UPDATE ON crm_opportunity_plans FOR EACH ROW EXECUTE FUNCTION crm_opportunity_plan_revision();
