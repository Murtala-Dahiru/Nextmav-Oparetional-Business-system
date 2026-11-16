CREATE OR REPLACE FUNCTION public.crm_relationship_timeline_filtered(p_org uuid,p_company uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 30,p_type text DEFAULT NULL,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL)
RETURNS TABLE(event_key text,module text,record_type text,record_id uuid,title text,occurred_at timestamptz,detail text,total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH valid AS(SELECT id FROM companies WHERE id=p_company AND organization_id=p_org AND deleted_at IS NULL AND public.can_access_module(p_org,'crm')),
 people AS(SELECT id FROM contacts WHERE organization_id=p_org AND company_id=p_company AND deleted_at IS NULL),
 opportunities AS(SELECT * FROM deals WHERE organization_id=p_org AND company_id=p_company AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id)),
 prospects AS(SELECT * FROM leads WHERE organization_id=p_org AND converted_contact_id IN(SELECT id FROM people) AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id)),
 events AS(
 SELECT 'activity:'||a.id AS event_key,'crm'::text AS module,
 CASE WHEN a.deal_id IS NOT NULL THEN 'deal' WHEN a.lead_id IS NOT NULL THEN 'lead' WHEN a.contact_id IS NOT NULL THEN 'contact' ELSE 'company' END AS record_type,
 coalesce(a.deal_id,a.lead_id,a.contact_id,a.company_id) AS record_id,a.subject AS title,coalesce(a.completed_at,a.created_at) AS occurred_at,
 a.activity_type||CASE WHEN a.due_at IS NOT NULL AND a.completed_at IS NULL THEN ' · scheduled follow-up' ELSE ' · logged activity' END AS detail
 FROM crm_activities a WHERE a.organization_id=p_org AND (a.company_id=p_company OR a.contact_id IN(SELECT id FROM people) OR a.deal_id IN(SELECT id FROM opportunities) OR a.lead_id IN(SELECT id FROM prospects))
 AND (a.deal_id IS NULL OR EXISTS(SELECT 1 FROM deals d WHERE d.id=a.deal_id AND d.organization_id=p_org AND d.deleted_at IS NULL AND public.crm_record_visible(d.organization_id,d.owner_id)))
 AND (a.lead_id IS NULL OR EXISTS(SELECT 1 FROM leads l WHERE l.id=a.lead_id AND l.organization_id=p_org AND l.deleted_at IS NULL AND public.crm_record_visible(l.organization_id,l.owner_id)))
 UNION ALL SELECT 'lead:'||id,'crm','lead',id,btrim(first_name||' '||last_name),converted_at,'Lead converted' FROM prospects WHERE converted_at IS NOT NULL
 UNION ALL SELECT 'deal-created:'||id,'crm','deal',id,name,created_at,'Opportunity created' FROM opportunities
 UNION ALL SELECT 'deal-closed:'||id,'crm','deal',id,name,closed_at,CASE WHEN stage='closed_won' THEN 'Deal won' ELSE 'Deal lost' END FROM opportunities WHERE stage IN ('closed_won','closed_lost') AND closed_at IS NOT NULL
 UNION ALL SELECT 'stage:'||e.id,'crm','deal',d.id,d.name,e.created_at,'Stage changed: '||coalesce(e.from_stage::text,'new')||' → '||e.to_stage::text FROM deal_stage_events e JOIN opportunities d ON d.id=e.deal_id WHERE e.organization_id=p_org
 UNION ALL SELECT 'contact:'||id,'crm','contact',id,btrim(first_name||' '||last_name),created_at,'Contact added' FROM contacts WHERE organization_id=p_org AND company_id=p_company AND deleted_at IS NULL
 UNION ALL SELECT 'project:'||id,'projects','project',id,name,created_at,'Project created · current status: '||status::text FROM projects WHERE organization_id=p_org AND client_company_id=p_company AND deleted_at IS NULL AND public.can_access_module(p_org,'projects')
 UNION ALL SELECT 'milestone:'||m.id,'projects','project',p.id,m.name,coalesce(m.completed_at,m.created_at),CASE WHEN m.completed_at IS NULL THEN 'Milestone created' ELSE 'Milestone completed' END FROM milestones m JOIN projects p ON p.id=m.project_id AND p.organization_id=m.organization_id WHERE m.organization_id=p_org AND p.client_company_id=p_company AND p.deleted_at IS NULL AND public.can_access_module(p_org,'projects')
 UNION ALL SELECT 'meeting:'||e.id,'projects','project',p.id,e.title,e.starts_at,'Scheduled meeting' FROM calendar_events e JOIN projects p ON p.id=e.project_id AND p.organization_id=e.organization_id WHERE e.organization_id=p_org AND p.client_company_id=p_company AND p.deleted_at IS NULL AND public.can_access_module(p_org,'projects') AND public.can_access_module(p_org,'calendar')
 UNION ALL SELECT 'invoice:'||id,'finance','invoice',id,invoice_number,created_at,'Invoice created · '||currency||' '||total::text FROM invoices WHERE organization_id=p_org AND company_id=p_company AND deleted_at IS NULL AND public.can_access_module(p_org,'finance')
 UNION ALL SELECT 'payment:'||p.id,'finance','invoice',i.id,i.invoice_number,p.paid_at,'Payment recorded · '||i.currency||' '||p.amount::text FROM payments p JOIN invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id WHERE p.organization_id=p_org AND i.company_id=p_company AND i.deleted_at IS NULL AND public.can_access_module(p_org,'finance')
 UNION ALL SELECT 'ticket:'||id,'support','ticket',id,subject,created_at,'Support ticket opened' FROM support_tickets WHERE organization_id=p_org AND contact_id IN(SELECT id FROM people) AND deleted_at IS NULL AND public.can_access_module(p_org,'support')
 UNION ALL SELECT 'ticket-resolved:'||id,'support','ticket',id,subject,resolved_at,'Support ticket resolved' FROM support_tickets WHERE organization_id=p_org AND contact_id IN(SELECT id FROM people) AND deleted_at IS NULL AND resolved_at IS NOT NULL AND public.can_access_module(p_org,'support')
 ) SELECT e.*,count(*) OVER() FROM events e WHERE EXISTS(SELECT 1 FROM valid) AND (p_type IS NULL OR split_part(e.event_key,':',1)=p_type) AND (p_from IS NULL OR e.occurred_at>=p_from) AND (p_to IS NULL OR e.occurred_at<p_to) ORDER BY occurred_at DESC,event_key DESC OFFSET greatest(0,least(p_offset,100000)) LIMIT greatest(1,least(p_limit,50))
$$;
REVOKE ALL ON FUNCTION public.crm_relationship_timeline_filtered(uuid,uuid,integer,integer,text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_relationship_timeline_filtered(uuid,uuid,integer,integer,text,timestamptz,timestamptz) TO authenticated;
