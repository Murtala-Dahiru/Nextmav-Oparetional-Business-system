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
