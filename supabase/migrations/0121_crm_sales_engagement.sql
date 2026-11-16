-- Sales work stays in crm_activities. No existing rows are rewritten.
ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS engagement_details jsonb NOT NULL DEFAULT '{}'::jsonb
 CHECK(jsonb_typeof(engagement_details)='object' AND octet_length(engagement_details::text)<=20000);
CREATE INDEX IF NOT EXISTS crm_engagement_diary ON crm_activities(organization_id,member_id,due_at,id) WHERE completed_at IS NULL AND due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_engagement_lead_history ON crm_activities(organization_id,lead_id,created_at);
CREATE INDEX IF NOT EXISTS crm_engagement_deal_history ON crm_activities(organization_id,deal_id,created_at);

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
 a.completed_at
 FROM crm_visible_activities a CROSS JOIN settings s
 LEFT JOIN contacts ct ON ct.id=a.contact_id AND ct.organization_id=p_org AND ct.deleted_at IS NULL
 LEFT JOIN companies c ON c.id=a.account_company_id AND c.organization_id=p_org AND c.deleted_at IS NULL
 LEFT JOIN leads l ON l.id=a.lead_id AND l.organization_id=p_org AND l.deleted_at IS NULL
 LEFT JOIN deals d ON d.id=a.deal_id AND d.organization_id=p_org AND d.deleted_at IS NULL
 WHERE a.organization_id=p_org AND a.member_id=auth_member_id(p_org)
 AND ((a.completed_at IS NULL AND a.due_at IS NOT NULL) OR (p_filter='completed' AND a.completed_at>now()-interval '30 days'))
 UNION ALL
 SELECT 'lead',l.id,'Make first contact','', 'call',NULL,l.updated_at,l.created_at,l.owner_id,l.company_name,concat_ws(' ',l.first_name,l.last_name),'lead',l.id,'first-contact',2,'No recorded call, email or completed meeting',NULL
 FROM leads l WHERE l.organization_id=p_org AND l.owner_id=auth_member_id(p_org) AND l.deleted_at IS NULL AND l.converted_at IS NULL AND l.status::text NOT IN ('won','lost')
 AND NOT EXISTS(SELECT 1 FROM crm_activities a WHERE a.organization_id=p_org AND a.lead_id=l.id AND a.activity_type IN ('call','email','meeting') AND (a.due_at IS NULL OR a.completed_at IS NOT NULL))
 UNION ALL
 SELECT 'deal',d.id,'Reconnect on '||d.name,'','followup',NULL,d.updated_at,coalesce(h.last_at,d.created_at),d.owner_id,coalesce(c.name,''),d.name,'deal',d.id,'quiet-deals',3,'No recorded interaction in 14 days',NULL
 FROM deals d LEFT JOIN companies c ON c.id=d.company_id AND c.organization_id=p_org AND c.deleted_at IS NULL
 CROSS JOIN LATERAL(SELECT max(coalesce(completed_at,created_at)) last_at FROM crm_activities a WHERE a.organization_id=p_org AND a.deal_id=d.id AND (a.due_at IS NULL OR a.completed_at IS NOT NULL))h
 WHERE d.organization_id=p_org AND d.owner_id=auth_member_id(p_org) AND d.deleted_at IS NULL AND d.stage::text NOT IN ('closed_won','closed_lost') AND d.closed_at IS NULL
 AND coalesce(h.last_at,d.created_at)<now()-interval '14 days'
), filtered AS (
 SELECT * FROM work WHERE (p_filter='all' AND completed_at IS NULL OR p_filter=bucket OR p_filter='meetings' AND action_type='meeting' AND completed_at IS NULL)
 AND (p_search='' OR position(lower(left(p_search,120)) IN lower(concat_ws(' ',title,customer,company)))>0)
), page AS (
 SELECT * FROM filtered ORDER BY rank,due_at NULLS LAST,last_interaction,id LIMIT 25 OFFSET (greatest(1,least(p_page,10000))-1)*25
)
SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',greatest(1,least(p_page,10000)),'page_size',25,'timezone',(SELECT zone FROM settings))
$$;
REVOKE ALL ON FUNCTION public.crm_sales_queue(uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_sales_queue(uuid,text,text,integer) TO authenticated;

CREATE TABLE IF NOT EXISTS crm_sales_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 owner_id uuid NOT NULL REFERENCES organization_members(id), visibility text NOT NULL CHECK(visibility IN ('personal','organization')),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), category text NOT NULL CHECK(length(category)<=80),
 subject text NOT NULL CHECK(length(subject)<=500), body text NOT NULL CHECK(length(body)<=20000),
 archived boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_sales_template_directory ON crm_sales_templates(organization_id,archived,updated_at DESC);
ALTER TABLE crm_sales_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_sales_templates FROM anon,authenticated;
GRANT SELECT ON crm_sales_templates TO authenticated;
DROP POLICY IF EXISTS sales_template_read ON crm_sales_templates;
CREATE POLICY sales_template_read ON crm_sales_templates FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm') AND (owner_id=auth_member_id(organization_id) OR visibility='organization'));

CREATE OR REPLACE FUNCTION public.crm_sales_template_save(p_org uuid,p_id uuid,p_revision integer,p_value jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing crm_sales_templates%ROWTYPE; rid uuid:=coalesce(p_id,gen_random_uuid());
BEGIN
 IF NOT can_access_module(p_org,'crm') OR auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'CRM write permission required' USING ERRCODE='42501'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO existing FROM crm_sales_templates WHERE id=p_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR (existing.owner_id<>auth_member_id(p_org) AND NOT(existing.visibility='organization' AND crm_automation_admin(p_org))) THEN RAISE EXCEPTION 'Template unavailable' USING ERRCODE='42501'; END IF;
  IF existing.revision<>p_revision THEN RAISE EXCEPTION 'Template changed; reload before saving' USING ERRCODE='PT409'; END IF;
 END IF;
 IF (p_value->>'visibility'='organization' OR existing.visibility='organization') AND NOT crm_automation_admin(p_org) THEN RAISE EXCEPTION 'Administrator required for shared templates' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO crm_sales_templates(id,organization_id,owner_id,visibility,name,category,subject,body) VALUES(rid,p_org,auth_member_id(p_org),p_value->>'visibility',p_value->>'name',p_value->>'category',p_value->>'subject',p_value->>'body');
 ELSE
  UPDATE crm_sales_templates SET visibility=p_value->>'visibility',name=p_value->>'name',category=p_value->>'category',subject=p_value->>'subject',body=p_value->>'body',archived=coalesce((p_value->>'archived')::boolean,false),revision=revision+1,updated_at=now() WHERE id=rid;
 END IF;
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.crm_sales_template_save(uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_sales_template_save(uuid,uuid,integer,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_sales_activity_action(p_org uuid,p_id uuid,p_updated timestamptz,p_action text,p_due timestamptz DEFAULT NULL,p_member uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE a crm_activities%ROWTYPE;
BEGIN
 IF NOT can_access_module(p_org,'crm') OR auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'CRM edit permission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM crm_activities WHERE organization_id=p_org AND id=p_id AND id IN(SELECT id FROM crm_visible_activities WHERE organization_id=p_org) FOR UPDATE;
 IF NOT FOUND OR (a.member_id IS DISTINCT FROM auth_member_id(p_org) AND NOT crm_automation_admin(p_org)) THEN RAISE EXCEPTION 'Activity unavailable' USING ERRCODE='42501'; END IF;
 IF a.updated_at IS DISTINCT FROM p_updated THEN RAISE EXCEPTION 'Activity changed; refresh the queue' USING ERRCODE='PT409'; END IF;
 IF a.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Activity is already completed' USING ERRCODE='PT409'; END IF;
 IF p_action='complete' THEN UPDATE crm_activities SET completed_at=now() WHERE id=p_id AND organization_id=p_org;
 ELSIF p_action='snooze' THEN
  IF p_due IS NULL OR p_due<=now() OR p_due>now()+interval '365 days' THEN RAISE EXCEPTION 'Choose a future due time within one year' USING ERRCODE='22023'; END IF;
  IF a.activity_type='meeting' THEN RAISE EXCEPTION 'Edit the meeting to reschedule its start and end together' USING ERRCODE='22023'; END IF;
  UPDATE crm_activities SET due_at=p_due,remind_at=NULL WHERE id=p_id AND organization_id=p_org;
 ELSIF p_action='reassign' THEN
  IF NOT crm_automation_admin(p_org) THEN RAISE EXCEPTION 'Administrator required to reassign' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM organization_members WHERE id=p_member AND organization_id=p_org AND is_active AND deleted_at IS NULL AND role IN ('owner','administrator','manager','sales_staff')) THEN RAISE EXCEPTION 'Choose an active CRM member' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM organization_members m WHERE m.id=p_member AND m.role='sales_staff') AND
   (a.lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM leads WHERE id=a.lead_id AND organization_id=p_org AND owner_id=p_member AND deleted_at IS NULL)
    OR a.deal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM deals WHERE id=a.deal_id AND organization_id=p_org AND owner_id=p_member AND deleted_at IS NULL)) THEN RAISE EXCEPTION 'Recipient cannot access the linked record' USING ERRCODE='42501'; END IF;
  UPDATE crm_activities SET member_id=p_member WHERE id=p_id AND organization_id=p_org;
 ELSE RAISE EXCEPTION 'Unknown activity action' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.crm_sales_activity_action(uuid,uuid,timestamptz,text,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_sales_activity_action(uuid,uuid,timestamptz,text,timestamptz,uuid) TO authenticated;
