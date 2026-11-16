-- Invoker rights are intentional: use the recipient's existing table RLS.
CREATE OR REPLACE FUNCTION public.notification_record_visible(p_org uuid,p_type text,p_entity text,p_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth_member_id(p_org) IS NULL THEN RETURN false; END IF;
 IF p_type='push_test' THEN RETURN true; END IF;
 IF p_id IS NOT NULL THEN
 CASE p_entity
 WHEN 'message' THEN RETURN EXISTS(SELECT 1 FROM messages m JOIN channel_members cm ON cm.channel_id=m.channel_id WHERE m.id=p_id AND m.organization_id=p_org AND m.deleted_at IS NULL AND cm.member_id=auth_member_id(p_org));
 WHEN 'channel' THEN RETURN EXISTS(SELECT 1 FROM channels c JOIN channel_members cm ON cm.channel_id=c.id WHERE c.id=p_id AND c.organization_id=p_org AND NOT c.is_archived AND cm.member_id=auth_member_id(p_org));
 WHEN 'task' THEN RETURN EXISTS(SELECT 1 FROM tasks WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL AND (p_type NOT IN ('task_due','task_overdue') OR (status<>'done' AND completed_at IS NULL AND assignee_id=auth_member_id(p_org))));
 WHEN 'project' THEN RETURN EXISTS(SELECT 1 FROM projects WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL);
 WHEN 'lead' THEN RETURN EXISTS(SELECT 1 FROM leads WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL);
 WHEN 'deal' THEN RETURN EXISTS(SELECT 1 FROM deals WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL);
 WHEN 'commercial' THEN RETURN EXISTS(SELECT 1 FROM crm_commercial_records WHERE id=p_id AND organization_id=p_org);
 WHEN 'agreement' THEN RETURN EXISTS(SELECT 1 FROM sign_envelopes WHERE id=p_id AND organization_id=p_org);
 WHEN 'ticket' THEN RETURN EXISTS(SELECT 1 FROM support_tickets WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL);
 WHEN 'invoice' THEN RETURN EXISTS(SELECT 1 FROM invoices WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL);
 WHEN 'expense' THEN RETURN EXISTS(SELECT 1 FROM expenses WHERE id=p_id AND organization_id=p_org);
 WHEN 'leave_request' THEN RETURN EXISTS(SELECT 1 FROM leave_requests WHERE id=p_id AND organization_id=p_org);
 WHEN 'hr_case' THEN RETURN EXISTS(SELECT 1 FROM hr_cases WHERE id=p_id AND organization_id=p_org);
 WHEN 'crm_activity' THEN RETURN EXISTS(SELECT 1 FROM crm_activities WHERE id=p_id AND organization_id=p_org AND completed_at IS NULL);
 WHEN 'todo' THEN RETURN EXISTS(SELECT 1 FROM todos WHERE id=p_id AND organization_id=p_org AND NOT is_done);
 ELSE NULL;
 END CASE;
 END IF;
 -- Unknown entity types are not pushed until their authorization is defined.
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION notification_record_visible(uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION notification_record_visible(uuid,text,text,uuid) TO authenticated;
