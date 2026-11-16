-- Complete, permission-aware customer totals in one statement snapshot.
-- The account API continues to return bounded previews separately.
CREATE OR REPLACE FUNCTION public.crm_account_summary(p_org uuid, p_company uuid, p_today date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH customer AS (
    SELECT id FROM companies WHERE id = p_company AND organization_id = p_org AND deleted_at IS NULL
      AND public.can_access_module(p_org, 'crm')
  ), deal_totals AS (
    SELECT count(*) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')) AS open_count,
      coalesce(sum(value) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')),0) AS open_value,
      coalesce(sum(value) FILTER (WHERE stage = 'closed_won'),0) AS won_value
    FROM deals WHERE organization_id = p_org AND company_id IN (SELECT id FROM customer) AND deleted_at IS NULL
      AND public.crm_record_visible(organization_id,owner_id)
  ), invoice_totals AS (
    SELECT currency, coalesce(sum(greatest(total - amount_paid,0)),0) AS outstanding,
      count(*) FILTER (WHERE due_date < p_today) AS overdue
    FROM invoices WHERE organization_id = p_org AND company_id IN (SELECT id FROM customer) AND deleted_at IS NULL
      AND status NOT IN ('paid','cancelled') AND public.can_access_module(p_org,'finance')
    GROUP BY currency
  ), project_totals AS (
    SELECT count(*) FILTER (WHERE p.status IN ('active','planning')) AS active,
      count(*) FILTER (WHERE h.is_at_risk) AS at_risk
    FROM projects p LEFT JOIN v_project_health h ON h.project_id=p.id AND h.organization_id=p.organization_id
    WHERE p.organization_id=p_org AND p.client_company_id IN (SELECT id FROM customer) AND p.deleted_at IS NULL
      AND public.can_access_module(p_org,'projects')
  )
  SELECT jsonb_build_object(
    'contacts', (SELECT count(*) FROM contacts WHERE organization_id=p_org AND company_id IN (SELECT id FROM customer) AND deleted_at IS NULL),
    'open_deals', d.open_count, 'open_deal_value', d.open_value, 'won_deal_value', d.won_value,
    'active_projects', p.active, 'projects_at_risk', p.at_risk,
    'last_contact', (SELECT max(coalesce(completed_at,created_at)) FROM crm_activities WHERE organization_id=p_org AND company_id IN (SELECT id FROM customer) AND (due_at IS NULL OR completed_at IS NOT NULL)),
    'next_follow_up', (SELECT min(due_at) FROM crm_activities WHERE organization_id=p_org AND company_id IN (SELECT id FROM customer) AND completed_at IS NULL),
    'invoice_balances', coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'outstanding',outstanding,'overdue',overdue) ORDER BY currency) FROM invoice_totals),'[]'),
    'open_tickets', (SELECT count(*) FROM support_tickets t JOIN contacts c ON c.id=t.contact_id AND c.organization_id=t.organization_id
      WHERE t.organization_id=p_org AND c.company_id IN (SELECT id FROM customer) AND c.deleted_at IS NULL AND t.deleted_at IS NULL
      AND t.status NOT IN ('resolved','closed') AND public.can_access_module(p_org,'support'))
  ) FROM deal_totals d CROSS JOIN project_totals p;
$$;
REVOKE ALL ON FUNCTION public.crm_account_summary(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_account_summary(uuid, uuid, date) TO authenticated;
