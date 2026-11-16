-- Only the worker reads this projection. Every row is a current business obligation.
CREATE OR REPLACE VIEW public.notification_deadlines WITH (security_invoker=true) AS
 SELECT t.organization_id,t.assignee_id AS recipient_id,'ticket_deadline'::text AS kind,'ticket'::text AS entity,t.id AS record_id,t.id AS source_id,t.due_at AS due_at,'support'::text AS module,'ticket'::text AS parameter
 FROM support_tickets t WHERE t.deleted_at IS NULL AND t.status NOT IN ('resolved','closed') AND t.due_at IS NOT NULL
 UNION ALL SELECT m.organization_id,p.owner_id,'milestone_due','project',m.project_id,m.id,m.due_date::timestamp AT TIME ZONE o.timezone,'projects','project'
 FROM milestones m JOIN projects p ON p.id=m.project_id AND p.organization_id=m.organization_id JOIN organizations o ON o.id=m.organization_id WHERE m.completed_at IS NULL AND p.deleted_at IS NULL AND m.due_date IS NOT NULL
 UNION ALL SELECT i.organization_id,i.assignee_id,'hr_action_due','hr_action',i.id,i.id,i.due_on::timestamp AT TIME ZONE o.timezone,'hr','action'
 FROM employee_checklist_items i JOIN organizations o ON o.id=i.organization_id WHERE NOT i.is_done AND i.due_on IS NOT NULL
 UNION ALL SELECT e.organization_id,e.owner_id,'sign_deadline','agreement',e.id,e.id,(e.data->>'expiresAt')::timestamptz,'crm','agreement'
 FROM sign_envelopes e WHERE e.status IN ('sent','in_progress') AND e.data->>'expiresAt' IS NOT NULL
 UNION ALL SELECT c.organization_id,c.owner_id,'commercial_obligation_due','commercial',c.record_id,c.id,c.due_on::timestamp AT TIME ZONE o.timezone,'crm','commercial'
 FROM crm_commercial_obligations c JOIN organizations o ON o.id=c.organization_id WHERE c.status='open' AND c.activity_id IS NULL
 UNION ALL SELECT e.organization_id,a.member_id,'event_due','event',e.id,e.id,e.starts_at,'calendar','event'
 FROM calendar_events e JOIN event_attendees a ON a.event_id=e.id WHERE a.response IN ('accepted','tentative');
REVOKE ALL ON public.notification_deadlines FROM PUBLIC,anon,authenticated;

-- Extend the existing recipient-side access check without duplicating its rules.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.notification_record_visible(uuid,text,text,uuid)'::regprocedure) INTO definition;
 IF position('employee_checklist_items' IN definition)=0 THEN
 definition:=replace(definition,'WHEN ''todo'' THEN',
 'WHEN ''hr_action'' THEN RETURN EXISTS(SELECT 1 FROM employee_checklist_items WHERE id=p_id AND organization_id=p_org AND NOT is_done AND assignee_id=auth_member_id(p_org));
  WHEN ''event'' THEN RETURN EXISTS(SELECT 1 FROM calendar_events WHERE id=p_id AND organization_id=p_org);
  WHEN ''membership'' THEN RETURN p_id=auth_member_id(p_org);
  WHEN ''todo'' THEN');
 EXECUTE definition;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notification_access_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.is_active AND NEW.deleted_at IS NULL AND NEW.role IS DISTINCT FROM OLD.role THEN
 INSERT INTO notifications(organization_id,recipient_id,type,title,body,entity_type,entity_id,link)
 VALUES(NEW.organization_id,NEW.id,'access_changed','Workspace access changed','Review your workspace access.','membership',NEW.id,'/dashboard');
 END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notification_access_changed() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_access_changed ON organization_members;
CREATE TRIGGER notification_access_changed AFTER UPDATE OF role ON organization_members FOR EACH ROW EXECUTE FUNCTION public.notification_access_changed();

-- Persist occurrence identity independently of a recipient dismissing their inbox row.
CREATE TABLE IF NOT EXISTS notification_reminder_occurrences (
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
 occurrence text NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,member_id,occurrence)
);
ALTER TABLE notification_reminder_occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_reminder_occurrences FROM anon,authenticated;
DROP POLICY IF EXISTS occurrence_private ON notification_reminder_occurrences;
CREATE POLICY occurrence_private ON notification_reminder_occurrences AS RESTRICTIVE FOR ALL TO authenticated USING(false) WITH CHECK(false);

CREATE OR REPLACE FUNCTION public.notification_sweep_deadlines(p_limit int DEFAULT 200) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE inserted int;
BEGIN
 WITH candidates AS MATERIALIZED (
 SELECT d.*,d.kind||':'||d.source_id||':'||extract(epoch FROM d.due_at)::bigint AS occurrence,
 CASE WHEN m.notification_prefs->>'reminderMinutes' IN ('0','15','60','1440') THEN (m.notification_prefs->>'reminderMinutes')::int ELSE 60 END AS advance
 FROM notification_deadlines d JOIN organization_members m ON m.id=d.recipient_id AND m.organization_id=d.organization_id
 WHERE m.is_active AND m.deleted_at IS NULL AND d.due_at BETWEEN now()-interval '15 minutes' AND now()+interval '1 day'
 ), due AS MATERIALIZED (
 SELECT c.* FROM candidates c WHERE c.due_at-make_interval(mins=>c.advance)<=now()
 AND NOT EXISTS(SELECT 1 FROM notification_reminder_occurrences r WHERE r.organization_id=c.organization_id AND r.member_id=c.recipient_id AND r.occurrence=c.occurrence)
 ORDER BY c.due_at,c.source_id LIMIT least(greatest(p_limit,1),500)
 ), claimed AS (
 INSERT INTO notification_reminder_occurrences(organization_id,member_id,occurrence,expires_at)
 SELECT organization_id,recipient_id,occurrence,due_at+interval '1 day' FROM due ON CONFLICT DO NOTHING RETURNING *
 ) INSERT INTO notifications(organization_id,recipient_id,type,title,body,entity_type,entity_id,link,dedupe_key,expires_at)
 SELECT d.organization_id,d.recipient_id,d.kind,CASE d.kind WHEN 'sign_deadline' THEN 'Signing deadline approaching' WHEN 'event_due' THEN 'Calendar event approaching' WHEN 'ticket_deadline' THEN 'Service deadline approaching' WHEN 'milestone_due' THEN 'Milestone approaching' WHEN 'hr_action_due' THEN 'Employee action due' ELSE 'Commercial obligation due' END,
 'Review the scheduled item in your workspace.',d.entity,d.record_id,'/dashboard?module='||d.module||'&'||d.parameter||'='||d.record_id,d.occurrence,d.due_at+interval '15 minutes'
 FROM due d JOIN claimed c ON c.organization_id=d.organization_id AND c.member_id=d.recipient_id AND c.occurrence=d.occurrence ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 DELETE FROM notification_reminder_occurrences WHERE expires_at<now()-interval '2 days';
 RETURN inserted;
END $$;
REVOKE ALL ON FUNCTION public.notification_sweep_deadlines(int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notification_sweep_deadlines(int) TO service_role;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='nextmav-business-deadlines') THEN
 PERFORM cron.schedule('nextmav-business-deadlines','* * * * *','SELECT public.notification_sweep_deadlines(200)');
 END IF; END IF;
END $$;
