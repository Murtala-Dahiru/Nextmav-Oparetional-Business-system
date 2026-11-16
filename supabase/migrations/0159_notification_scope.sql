-- Revalidate a queued assignment against its current owner and the caller's RLS.
CREATE OR REPLACE FUNCTION public.notification_assignment_current(p_org uuid,p_type text,p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT CASE p_type
 WHEN 'task_assigned' THEN EXISTS(SELECT 1 FROM tasks WHERE id=p_id AND organization_id=p_org AND assignee_id=auth_member_id(p_org) AND deleted_at IS NULL)
 WHEN 'ticket_assigned' THEN EXISTS(SELECT 1 FROM support_tickets WHERE id=p_id AND organization_id=p_org AND assignee_id=auth_member_id(p_org) AND deleted_at IS NULL)
 WHEN 'lead_assigned' THEN EXISTS(SELECT 1 FROM leads WHERE id=p_id AND organization_id=p_org AND owner_id=auth_member_id(p_org) AND deleted_at IS NULL)
 WHEN 'deal_assigned' THEN EXISTS(SELECT 1 FROM deals WHERE id=p_id AND organization_id=p_org AND owner_id=auth_member_id(p_org) AND deleted_at IS NULL)
 WHEN 'hr_case_assigned' THEN EXISTS(SELECT 1 FROM hr_cases WHERE id=p_id AND organization_id=p_org AND assigned_to=auth_member_id(p_org))
 WHEN 'crm_activity_assigned' THEN EXISTS(SELECT 1 FROM crm_activities WHERE id=p_id AND organization_id=p_org AND member_id=auth_member_id(p_org) AND completed_at IS NULL)
 ELSE true END
$$;
REVOKE ALL ON FUNCTION public.notification_assignment_current(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.notification_assignment_current(uuid,text,uuid) TO authenticated;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.notification_record_visible(uuid,text,text,uuid)'::regprocedure) INTO definition;
 IF position('notification_assignment_current' IN definition)=0 THEN
 definition:=replace(definition,'IF auth_member_id(p_org) IS NULL THEN','IF NOT notification_assignment_current(p_org,p_type,p_id) OR auth_member_id(p_org) IS NULL THEN');
 EXECUTE definition;
 END IF;
END $$;
