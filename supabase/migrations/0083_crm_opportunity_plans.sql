CREATE TABLE IF NOT EXISTS crm_opportunity_plans(
 deal_id uuid PRIMARY KEY REFERENCES deals(id),organization_id uuid NOT NULL REFERENCES organizations(id),
 version integer NOT NULL DEFAULT 1,business_need text NOT NULL DEFAULT '',decision_process text NOT NULL DEFAULT '',close_plan text NOT NULL DEFAULT '',
 stakeholders jsonb NOT NULL DEFAULT '[]',updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES organization_members(id)
);
ALTER TABLE crm_opportunity_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_opportunity_plans FROM anon,authenticated;
GRANT SELECT ON crm_opportunity_plans TO authenticated;
DROP POLICY IF EXISTS crm_opportunity_plan_read ON crm_opportunity_plans;
CREATE POLICY crm_opportunity_plan_read ON crm_opportunity_plans FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM deals d WHERE d.id=deal_id AND d.organization_id=crm_opportunity_plans.organization_id AND d.deleted_at IS NULL AND crm_record_visible(d.organization_id,d.owner_id)));
CREATE OR REPLACE FUNCTION public.crm_save_opportunity_plan(p_org uuid,p_deal uuid,p_version integer,p_data jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d deals%ROWTYPE; current_version integer; item jsonb;
BEGIN
 IF auth_member_id(p_org) IS NULL OR auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'Deal planning is not permitted' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM deals WHERE id=p_deal AND organization_id=p_org AND deleted_at IS NULL AND crm_record_visible(organization_id,owner_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE='P0002'; END IF;
 SELECT version INTO current_version FROM crm_opportunity_plans WHERE deal_id=p_deal;
 IF p_version IS NULL OR coalesce(current_version,0)<>p_version THEN RAISE EXCEPTION 'Opportunity plan changed; reload before saving' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_data)<>'object' OR jsonb_typeof(p_data->'stakeholders') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'stakeholders')>40 THEN RAISE EXCEPTION 'Invalid opportunity plan' USING ERRCODE='22023'; END IF;
 IF greatest(length(p_data->>'businessNeed'),length(p_data->>'decisionProcess'),length(p_data->>'closePlan'))>12000 THEN RAISE EXCEPTION 'Plan text is too long' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_data->'stakeholders') LOOP
  IF item->>'role' IS NULL OR item->>'role' NOT IN ('economic_buyer','decision_maker','champion','technical_evaluator','influencer') OR NOT EXISTS(SELECT 1 FROM contacts WHERE id=(item->>'contactId')::uuid AND organization_id=p_org AND deleted_at IS NULL AND (d.company_id IS NULL OR company_id=d.company_id)) THEN RAISE EXCEPTION 'Stakeholder must be an existing contact at the opportunity company with an explicit role' USING ERRCODE='22023'; END IF;
 END LOOP;
 INSERT INTO crm_opportunity_plans(deal_id,organization_id,version,business_need,decision_process,close_plan,stakeholders,updated_by)
 VALUES(p_deal,p_org,p_version+1,coalesce(p_data->>'businessNeed',''),coalesce(p_data->>'decisionProcess',''),coalesce(p_data->>'closePlan',''),p_data->'stakeholders',auth_member_id(p_org))
 ON CONFLICT(deal_id) DO UPDATE SET version=excluded.version,business_need=excluded.business_need,decision_process=excluded.decision_process,close_plan=excluded.close_plan,stakeholders=excluded.stakeholders,updated_by=excluded.updated_by,updated_at=now();
 RETURN p_version+1;
END $$;
REVOKE ALL ON FUNCTION public.crm_save_opportunity_plan(uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_opportunity_plan(uuid,uuid,integer,jsonb) TO authenticated;
