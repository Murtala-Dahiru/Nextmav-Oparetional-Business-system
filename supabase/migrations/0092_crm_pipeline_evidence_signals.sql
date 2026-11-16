CREATE OR REPLACE FUNCTION public.crm_visible_deal_requirement(p_org uuid,p_deal uuid,p_field text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT crm_deal_requirement(d,p_field) FROM deals d WHERE d.id=p_deal AND d.organization_id=p_org AND d.deleted_at IS NULL AND crm_record_visible(d.organization_id,d.owner_id)
$$;
REVOKE ALL ON FUNCTION public.crm_visible_deal_requirement(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_visible_deal_requirement(uuid,uuid,text) TO authenticated;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.crm_pipeline_workspace(uuid,uuid,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,'CASE WHEN awaiting_approval THEN ''Awaiting approval'' END,',
 'CASE WHEN awaiting_approval THEN ''Awaiting approval'' END,
    CASE WHEN NOT EXISTS(SELECT 1 FROM crm_opportunity_plans p CROSS JOIN LATERAL jsonb_array_elements(p.stakeholders) s WHERE p.organization_id=p_org AND p.deal_id=facts.id AND s->>''role'' IN (''decision_maker'',''economic_buyer'')) THEN ''No documented opportunity decision-maker'' END,
    CASE WHEN EXISTS(SELECT 1 FROM crm_pipeline_stages s CROSS JOIN LATERAL unnest(s.required_fields) field JOIN deals d ON d.id=facts.id WHERE s.id=facts.pipeline_stage_id AND s.organization_id=p_org AND (crm_deal_requirement(d,field) IS NULL OR crm_deal_requirement(d,field)=''null''::jsonb OR btrim(crm_deal_requirement(d,field)#>>''{}'')='''' OR (field=''value'' AND d.value<=0))) THEN ''Incomplete current-stage evidence'' END,');
 definition:=replace(definition,'crm_deal_requirement(d,field)','crm_visible_deal_requirement(p_org,d.id,field)');
 EXECUTE definition;
END $$;
