-- Rate limiting survives clearing notification history. Aggregate locks are short,
-- scoped to the registered device, and never held across network requests.
ALTER TABLE notification_devices ADD COLUMN IF NOT EXISTS last_test_at timestamptz;
CREATE OR REPLACE FUNCTION public.notification_test(p_org uuid,p_device uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=auth_member_id(p_org); result bigint;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Membership required' USING ERRCODE='42501'; END IF;
 UPDATE notification_devices SET last_test_at=now() WHERE id=p_device AND member_id=me AND organization_id=p_org AND enabled AND retired_at IS NULL AND (last_test_at IS NULL OR last_test_at<now()-interval '1 minute');
 IF NOT FOUND THEN RAISE EXCEPTION 'Device unavailable or already tested this minute' USING ERRCODE='22023'; END IF;
 INSERT INTO notifications(organization_id,recipient_id,type,title,body,link,expires_at) VALUES(p_org,me,'push_test','Notification test','Your device notification test is queued.','/dashboard',now()+interval '5 minutes') RETURNING id INTO result;
 DELETE FROM notification_deliveries WHERE notification_id=result AND device_id<>p_device;
 INSERT INTO notification_deliveries(organization_id,notification_id,device_id) VALUES(p_org,result,p_device) ON CONFLICT DO NOTHING;
 RETURN result;
END $$;

-- Task reminders predate the shared occurrence ledger. Include it in the
-- bounded candidate scan so dismissed reminders cannot reappear or starve later tasks.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.notification_sweep_tasks(integer)'::regprocedure) INTO definition;
 IF position('notification_reminder_occurrences' IN definition)=0 THEN
 definition:=replace(definition,' AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.recipient_id=t.assignee_id',
 ' AND NOT EXISTS(SELECT 1 FROM notification_reminder_occurrences r WHERE r.organization_id=t.organization_id AND r.member_id=t.assignee_id AND r.occurrence=''task:''||t.id||'':''||t.due_date||'':''||CASE WHEN t.due_date<(now() AT TIME ZONE o.timezone)::date THEN ''task_overdue'' ELSE ''task_due'' END)
 AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.recipient_id=t.assignee_id');
 EXECUTE definition;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.notification_remember_task_deadline() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO notification_reminder_occurrences(organization_id,member_id,occurrence,expires_at) VALUES(NEW.organization_id,NEW.recipient_id,NEW.dedupe_key,NEW.expires_at) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notification_remember_task_deadline() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_remember_task_deadline ON notifications;
CREATE TRIGGER notification_remember_task_deadline AFTER INSERT ON notifications FOR EACH ROW WHEN (NEW.type IN ('task_due','task_overdue') AND NEW.dedupe_key IS NOT NULL) EXECUTE FUNCTION public.notification_remember_task_deadline();
