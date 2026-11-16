-- Priority extends the established activity details, preserving every existing record.
ALTER TABLE crm_activities DROP CONSTRAINT IF EXISTS crm_activity_priority_valid;
ALTER TABLE crm_activities ADD CONSTRAINT crm_activity_priority_valid CHECK(NOT(engagement_details ? 'priority') OR (jsonb_typeof(engagement_details->'priority')='string' AND engagement_details->>'priority' IN ('low','normal','high')));
CREATE OR REPLACE FUNCTION public.crm_sales_queue(p_org uuid,p_filter text DEFAULT 'all',p_search text DEFAULT '',p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
WITH settings AS (
 SELECT coalesce(timezone,'UTC') zone FROM organizations WHERE id=p_org AND can_access_module(p_org,'crm')
), work AS (
 SELECT 'activity'::text kind,a.id,a.subject title,a.body,a.activity_type::text action_type,a.due_at,a.updated_at,
 a.created_at last_interaction,a.member_id owner_id,
 coalesce(c.name,l.company_name,'') company,
 coalesce(nullif(concat_ws(' ',ct.first_name,ct.last_name),''),nullif(concat_ws(' ',l.first_name,l.last_name),''),c.name,d.name,'CRM activity') customer,
 CASE WHEN a.lead_id IS NOT NULL THEN 'lead' WHEN a.deal_id IS NOT NULL THEN 'deal' WHEN a.contact_id IS NOT NULL THEN 'contact' ELSE 'company' END record_type,
 coalesce(a.lead_id,a.deal_id,a.contact_id,a.company_id) record_id,
 CASE WHEN a.completed_at IS NOT NULL THEN 'completed' WHEN (a.due_at AT TIME ZONE s.zone)::date < (now() AT TIME ZONE s.zone)::date THEN 'overdue' WHEN (a.due_at AT TIME ZONE s.zone)::date=(now() AT TIME ZONE s.zone)::date THEN 'today' ELSE 'upcoming' END bucket,
 CASE WHEN a.completed_at IS NOT NULL THEN 5 WHEN a.due_at<now() THEN 0 WHEN (a.due_at AT TIME ZONE s.zone)::date=(now() AT TIME ZONE s.zone)::date THEN 1 ELSE 4 END rank,
 CASE WHEN a.completed_at IS NOT NULL THEN 'Activity completed' WHEN (a.due_at AT TIME ZONE s.zone)::date < (now() AT TIME ZONE s.zone)::date THEN 'Overdue by '||((now() AT TIME ZONE s.zone)::date-(a.due_at AT TIME ZONE s.zone)::date)||' days' WHEN a.due_at<now() THEN 'Due earlier today' ELSE 'Scheduled next action' END reason,
 a.completed_at,coalesce(a.engagement_details->>'priority','normal') priority,CASE a.engagement_details->>'priority' WHEN 'high' THEN 0 WHEN 'low' THEN 2 ELSE 1 END priority_rank
 FROM crm_visible_activities a CROSS JOIN settings s
 LEFT JOIN contacts ct ON ct.id=a.contact_id AND ct.organization_id=p_org AND ct.deleted_at IS NULL
 LEFT JOIN companies c ON c.id=a.account_company_id AND c.organization_id=p_org AND c.deleted_at IS NULL
 LEFT JOIN leads l ON l.id=a.lead_id AND l.organization_id=p_org AND l.deleted_at IS NULL
 LEFT JOIN deals d ON d.id=a.deal_id AND d.organization_id=p_org AND d.deleted_at IS NULL
 WHERE a.organization_id=p_org AND a.member_id=auth_member_id(p_org)
 AND ((a.completed_at IS NULL AND a.due_at IS NOT NULL) OR (p_filter='completed' AND a.completed_at>now()-interval '30 days'))
 UNION ALL
 SELECT 'lead',l.id,'Make first contact','', 'call',NULL,l.updated_at,l.created_at,l.owner_id,l.company_name,concat_ws(' ',l.first_name,l.last_name),'lead',l.id,'first-contact',2,'No recorded call, email or completed meeting',NULL,'normal',1
 FROM leads l WHERE l.organization_id=p_org AND l.owner_id=auth_member_id(p_org) AND l.deleted_at IS NULL AND l.converted_at IS NULL AND l.status::text NOT IN ('won','lost')
 AND NOT EXISTS(SELECT 1 FROM crm_activities a WHERE a.organization_id=p_org AND a.lead_id=l.id AND a.activity_type IN ('call','email','meeting') AND (a.due_at IS NULL OR a.completed_at IS NOT NULL))
 UNION ALL
 SELECT 'deal',d.id,'Reconnect on '||d.name,'','followup',NULL,d.updated_at,coalesce(h.last_at,d.created_at),d.owner_id,coalesce(c.name,''),d.name,'deal',d.id,'quiet-deals',3,'No recorded interaction in 14 days',NULL,'normal',1
 FROM deals d LEFT JOIN companies c ON c.id=d.company_id AND c.organization_id=p_org AND c.deleted_at IS NULL
 CROSS JOIN LATERAL(SELECT max(coalesce(completed_at,created_at)) last_at FROM crm_activities a WHERE a.organization_id=p_org AND a.deal_id=d.id AND (a.due_at IS NULL OR a.completed_at IS NOT NULL))h
 WHERE d.organization_id=p_org AND d.owner_id=auth_member_id(p_org) AND d.deleted_at IS NULL AND d.stage::text NOT IN ('closed_won','closed_lost') AND d.closed_at IS NULL
 AND coalesce(h.last_at,d.created_at)<now()-interval '14 days'
), filtered AS (
 SELECT * FROM work WHERE (p_filter='all' AND completed_at IS NULL OR p_filter=bucket OR p_filter='meetings' AND action_type='meeting' AND completed_at IS NULL)
 AND (p_search='' OR position(lower(left(p_search,120)) IN lower(concat_ws(' ',title,customer,company)))>0)
), page AS (
 SELECT * FROM filtered ORDER BY rank,priority_rank,due_at NULLS LAST,last_interaction,id LIMIT 25 OFFSET (greatest(1,least(p_page,10000))-1)*25
)
SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',greatest(1,least(p_page,10000)),'page_size',25,'timezone',(SELECT zone FROM settings))
$$;
REVOKE ALL ON FUNCTION public.crm_sales_queue(uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_sales_queue(uuid,text,text,integer) TO authenticated;

