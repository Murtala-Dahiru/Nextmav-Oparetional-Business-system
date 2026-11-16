-- Resolve the account once so contact-linked activity is included even without a
-- redundant company_id. Hidden deals and leads remain excluded by the view.
CREATE OR REPLACE VIEW public.crm_visible_activities WITH(security_invoker=true) AS
 SELECT a.*,coalesce(a.company_id,c.company_id,d.company_id) AS account_company_id
 FROM crm_activities a
 LEFT JOIN contacts c ON c.id=a.contact_id AND c.organization_id=a.organization_id AND c.deleted_at IS NULL
 LEFT JOIN deals d ON d.id=a.deal_id AND d.organization_id=a.organization_id AND d.deleted_at IS NULL
 WHERE public.can_access_module(a.organization_id,'crm')
 AND (a.deal_id IS NULL OR (d.id IS NOT NULL AND public.crm_record_visible(d.organization_id,d.owner_id)))
 AND (a.lead_id IS NULL OR EXISTS(SELECT 1 FROM leads l WHERE l.id=a.lead_id AND l.organization_id=a.organization_id AND l.deleted_at IS NULL AND public.crm_record_visible(l.organization_id,l.owner_id)));
GRANT SELECT ON public.crm_visible_activities TO authenticated;

-- Permission-aware briefing. Aggregates stay in Postgres; finance remains its source of truth.
CREATE OR REPLACE FUNCTION public.crm_customer_brief(p_org uuid,p_company uuid,p_today date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
WITH valid AS (SELECT id FROM companies WHERE organization_id=p_org AND id=p_company AND deleted_at IS NULL AND public.can_access_module(p_org,'crm')),
engagement AS (
 SELECT a.* FROM crm_activities a WHERE a.organization_id=p_org AND EXISTS(SELECT 1 FROM valid)
 AND (a.company_id=p_company OR a.contact_id IN(SELECT id FROM contacts WHERE organization_id=p_org AND company_id=p_company AND deleted_at IS NULL)
 OR a.deal_id IN(SELECT id FROM deals WHERE organization_id=p_org AND company_id=p_company AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id)))
 AND (a.deal_id IS NULL OR EXISTS(SELECT 1 FROM deals d WHERE d.id=a.deal_id AND d.organization_id=p_org AND d.deleted_at IS NULL AND public.crm_record_visible(d.organization_id,d.owner_id)))
 AND (a.lead_id IS NULL OR EXISTS(SELECT 1 FROM leads l WHERE l.id=a.lead_id AND l.organization_id=p_org AND l.deleted_at IS NULL AND public.crm_record_visible(l.organization_id,l.owner_id)))
), paid AS (
 SELECT i.currency,sum(p.amount) AS collected FROM payments p JOIN invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id
 WHERE p.organization_id=p_org AND i.company_id IN(SELECT id FROM valid) AND i.deleted_at IS NULL AND public.can_access_module(p_org,'finance') GROUP BY i.currency
)
SELECT public.crm_account_summary(p_org,p_company,p_today) || jsonb_build_object(
 'invoice_balances',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'outstanding',outstanding,'overdue',overdue) ORDER BY currency) FROM (
 SELECT currency,sum(greatest(total-amount_paid,0)) outstanding,count(*) FILTER(WHERE due_date<p_today) overdue
 FROM invoices WHERE organization_id=p_org AND company_id IN(SELECT id FROM valid) AND deleted_at IS NULL
 AND status IN('sent','partially_paid','overdue') AND total>amount_paid AND public.can_access_module(p_org,'finance') GROUP BY currency
 ) balances),'[]'::jsonb),
 'active_projects',(SELECT count(*) FROM crm_visible_projects WHERE organization_id=p_org AND client_company_id IN(SELECT id FROM valid) AND status IN('active','planning')),
 'projects_at_risk',(SELECT count(*) FROM v_project_health h JOIN crm_visible_projects p ON p.id=h.project_id AND p.organization_id=h.organization_id WHERE p.organization_id=p_org AND p.client_company_id IN(SELECT id FROM valid) AND h.is_at_risk),
 'last_contact',(SELECT max(coalesce(completed_at,created_at)) FROM engagement WHERE activity_type IN('call','email','meeting') AND (due_at IS NULL OR completed_at IS NOT NULL)),
 'next_follow_up',(SELECT min(due_at) FROM engagement WHERE due_at IS NOT NULL AND completed_at IS NULL),
 'overdue_actions',(SELECT count(*) FROM engagement WHERE due_at::date<p_today AND completed_at IS NULL) +
 (SELECT count(*) FROM crm_account_plans p CROSS JOIN LATERAL jsonb_array_elements(p.items) i WHERE p.organization_id=p_org AND p.company_id IN(SELECT id FROM valid) AND i->>'kind'='action' AND i->>'status'<>'completed' AND nullif(i->>'dueDate','')::date<p_today),
 'decision_makers',(SELECT count(*) FROM contacts WHERE organization_id=p_org AND company_id IN(SELECT id FROM valid) AND deleted_at IS NULL AND is_active AND lower(crm_profile->>'relationshipRole') IN('decision-maker','economic buyer')),
 'stalled_deals',(SELECT count(*) FROM deals WHERE organization_id=p_org AND company_id IN(SELECT id FROM valid) AND deleted_at IS NULL AND stage NOT IN('closed_won','closed_lost') AND updated_at<now()-interval '30 days' AND public.crm_record_visible(organization_id,owner_id)),
 'collected_payments',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'collected',collected) ORDER BY currency) FROM paid),'[]'::jsonb)
);
$$;
REVOKE ALL ON FUNCTION public.crm_customer_brief(uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_customer_brief(uuid,uuid,date) TO authenticated;


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
    RAISE EXCEPTION 'Account plan changed; reload before saving' USING ERRCODE='P0001';
  END IF;
  owner_member := nullif(p_plan->>'ownerId','')::uuid;
  IF owner_member IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members WHERE id=owner_member AND organization_id=p_org) THEN
    RAISE EXCEPTION 'Owner must belong to this organization' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(coalesce(p_plan->'items','[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_plan->'items','[]'::jsonb)) > 100 THEN
    RAISE EXCEPTION 'Invalid structured plan' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(coalesce(p_plan->'items','[]'::jsonb))) <> (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(coalesce(p_plan->'items','[]'::jsonb)) x) THEN
    RAISE EXCEPTION 'Plan item identifiers must be unique' USING ERRCODE='22023'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'items','[]'::jsonb)) LOOP
    IF jsonb_typeof(item)<>'object' OR nullif(item->>'id','') IS NULL OR item->>'kind' IS NULL OR item->>'status' IS NULL OR item->>'priority' IS NULL OR item->>'progress' IS NULL OR item->>'kind' NOT IN ('objective','action','stakeholder') OR coalesce(length(item->>'title'),0) NOT BETWEEN 1 AND 250
      OR item->>'status' NOT IN ('planned','in_progress','completed','blocked') OR item->>'priority' NOT IN ('low','normal','high')
      OR (item->>'progress')::integer NOT BETWEEN 0 AND 100 OR length(coalesce(item->>'description','')) > 4000 THEN
      RAISE EXCEPTION 'Invalid plan item' USING ERRCODE='22023'; END IF;
    PERFORM (item->>'id')::uuid;
    PERFORM nullif(item->>'dueDate','')::date;
    IF length(coalesce(item->>'role',''))>250 OR length(coalesce(item->>'influence',''))>1000 THEN
      RAISE EXCEPTION 'Stakeholder context is too long' USING ERRCODE='22023'; END IF;
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
