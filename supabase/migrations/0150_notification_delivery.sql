-- Extend the existing notification engine. No historical records are replayed.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES organization_members(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notification_dedupe ON notifications(organization_id,recipient_id,dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notification_history ON notifications(recipient_id,created_at DESC,id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notification_org_id ON notifications(organization_id,id);

CREATE OR REPLACE FUNCTION notification_prepare() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM organization_members m JOIN profiles p ON p.id=m.user_id WHERE m.id=NEW.recipient_id AND m.organization_id=NEW.organization_id AND m.is_active AND m.deleted_at IS NULL AND p.is_active AND p.auth_deleted_at IS NULL) THEN RETURN NULL; END IF;
 NEW.actor_id:=auth_member_id(NEW.organization_id);
 IF NEW.actor_id=NEW.recipient_id AND NEW.type NOT IN ('todo_reminder','push_test') THEN RETURN NULL; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION notification_prepare() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_prepare ON notifications;
CREATE TRIGGER notification_prepare BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION notification_prepare();

-- Only trusted producers may write content. Recipients may change read state only.
DROP POLICY IF EXISTS notifications_insert ON notifications;
REVOKE INSERT, UPDATE ON notifications FROM authenticated;
GRANT UPDATE(is_read,read_at) ON notifications TO authenticated;
REVOKE ALL ON FUNCTION notify_members(uuid,uuid[],text,text,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS notifications_delete ON notifications;
DROP POLICY IF EXISTS notifications_delete ON notifications;
CREATE POLICY notifications_delete ON notifications FOR DELETE TO authenticated USING(recipient_id=auth_member_id(organization_id));

CREATE TABLE IF NOT EXISTS notification_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
 endpoint text NOT NULL CHECK(length(endpoint)<=4096),
 p256dh text NOT NULL CHECK(length(p256dh)<=200), auth text NOT NULL CHECK(length(auth)<=100),
 label text NOT NULL DEFAULT 'Browser' CHECK(length(label)<=80),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 last_accepted_at timestamptz, retired_at timestamptz,
 UNIQUE(member_id,endpoint), UNIQUE(organization_id,id)
);
ALTER TABLE notification_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_devices FROM anon,authenticated;
GRANT SELECT,DELETE ON notification_devices TO authenticated;
DROP POLICY IF EXISTS notification_device_owner ON notification_devices;
CREATE POLICY notification_device_owner ON notification_devices FOR ALL TO authenticated
 USING(member_id=auth_member_id(organization_id)) WITH CHECK(member_id=auth_member_id(organization_id));

CREATE TABLE IF NOT EXISTS notification_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 notification_id bigint NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES notification_devices(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','accepted','failed','skipped')),
 attempts integer NOT NULL DEFAULT 0, failures integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz,
 last_code integer, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(notification_id,device_id), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,notification_id) REFERENCES notifications(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,device_id) REFERENCES notification_devices(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS notification_delivery_queue ON notification_deliveries(available_at,id) WHERE state IN ('pending','processing');
CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 delivery_id bigint NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
 attempt integer NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 result text NOT NULL DEFAULT 'started', provider_code integer,
 UNIQUE(delivery_id,attempt),
 FOREIGN KEY(organization_id,delivery_id) REFERENCES notification_deliveries(organization_id,id) ON DELETE CASCADE
);
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_deliveries,notification_delivery_attempts FROM anon,authenticated;

CREATE OR REPLACE FUNCTION notification_enqueue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO notification_deliveries(organization_id,notification_id,device_id)
 SELECT NEW.organization_id,NEW.id,d.id FROM notification_devices d JOIN organization_members m ON m.id=d.member_id
 WHERE d.member_id=NEW.recipient_id AND d.organization_id=NEW.organization_id AND d.enabled AND d.retired_at IS NULL
 AND m.is_active AND m.deleted_at IS NULL AND m.organization_id=NEW.organization_id
 AND m.notification_prefs->>'push'='true'
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION notification_enqueue() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_enqueue ON notifications;
CREATE TRIGGER notification_enqueue AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION notification_enqueue();

-- Database functions keep ownership independent of caller-provided member IDs.
CREATE OR REPLACE FUNCTION notification_save_device(p_endpoint text,p_p256dh text,p_auth text,p_label text,p_org uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=auth_member_id(p_org); result uuid;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Membership required' USING ERRCODE='42501'; END IF;
 -- Endpoint allowlist prevents push transport being used for arbitrary server requests.
 IF p_endpoint !~ '^https://(fcm.googleapis.com|updates.push.services.mozilla.com|updates-autopush.stage.mozaws.net|web.push.apple.com|[a-z0-9-]+\.notify.windows.com)/' THEN
 RAISE EXCEPTION 'Unsupported push service' USING ERRCODE='22023'; END IF;
 IF p_p256dh !~ '^[A-Za-z0-9_-]{87}=?$' OR p_auth !~ '^[A-Za-z0-9_-]{22}={0,2}$' THEN RAISE EXCEPTION 'Invalid subscription keys' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM organization_members WHERE id=me FOR UPDATE;
 -- A browser registration transferred to another account must stop the old account's delivery.
 DELETE FROM notification_devices d USING organization_members previous,organization_members current_member
 WHERE d.member_id=previous.id AND current_member.id=me AND previous.user_id<>current_member.user_id AND d.endpoint=p_endpoint;
 IF (SELECT count(*) FROM notification_devices WHERE member_id=me)>=20 AND NOT EXISTS(SELECT 1 FROM notification_devices WHERE member_id=me AND endpoint=p_endpoint) THEN RAISE EXCEPTION 'Device limit reached' USING ERRCODE='22023'; END IF;
 INSERT INTO notification_devices(organization_id,member_id,endpoint,p256dh,auth,label)
 VALUES(p_org,me,p_endpoint,p_p256dh,p_auth,left(p_label,80))
 ON CONFLICT(member_id,endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,label=excluded.label,enabled=true,retired_at=NULL,updated_at=now()
 RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION notification_save_device(text,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION notification_save_device(text,text,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION notification_preferences(p_org uuid,p_prefs jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=auth_member_id(p_org);
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Membership required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_prefs)<>'object' OR length(p_prefs::text)>4000 THEN RAISE EXCEPTION 'Invalid preferences' USING ERRCODE='22023'; END IF;
 UPDATE organization_members SET notification_prefs=p_prefs WHERE id=me;
 RETURN p_prefs;
END $$;
REVOKE ALL ON FUNCTION notification_preferences(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION notification_preferences(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION notification_test(p_org uuid,p_device uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=auth_member_id(p_org); result bigint;
BEGIN
 IF me IS NULL OR NOT EXISTS(SELECT 1 FROM notification_devices WHERE id=p_device AND member_id=me AND enabled AND retired_at IS NULL) THEN RAISE EXCEPTION 'Device unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM organization_members WHERE id=me FOR UPDATE;
 IF EXISTS(SELECT 1 FROM notifications WHERE recipient_id=me AND type='push_test' AND created_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'Wait one minute before testing again' USING ERRCODE='22023'; END IF;
 INSERT INTO notifications(organization_id,recipient_id,type,title,body,link,expires_at) VALUES(p_org,me,'push_test','Notification test','Your device notification test is queued.','/dashboard',now()+interval '5 minutes') RETURNING id INTO result;
 DELETE FROM notification_deliveries WHERE notification_id=result AND device_id<>p_device;
 INSERT INTO notification_deliveries(organization_id,notification_id,device_id) VALUES(p_org,result,p_device) ON CONFLICT DO NOTHING;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION notification_test(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION notification_test(uuid,uuid) TO authenticated;

-- Replace mentions with one transactional fanout; no sender alerts or outsiders.
CREATE OR REPLACE FUNCTION notify_message_mentions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO notifications(organization_id,recipient_id,type,title,body,entity_type,entity_id,link,dedupe_key,expires_at)
 SELECT NEW.organization_id,cm.member_id,CASE WHEN cm.member_id=ANY(NEW.mentions) THEN 'message_mention' ELSE 'message_received' END,
 'New message from your team','You have a new message in your workspace.','message',NEW.id,
 '/dashboard?module=communication&channel='||NEW.channel_id,'message:'||NEW.id,now()+interval '2 days'
 FROM channel_members cm JOIN organization_members m ON m.id=cm.member_id JOIN channels c ON c.id=cm.channel_id
 WHERE cm.channel_id=NEW.channel_id AND cm.member_id<>NEW.sender_id AND (NOT cm.is_muted OR cm.member_id=ANY(NEW.mentions))
 AND m.organization_id=NEW.organization_id AND m.is_active AND m.deleted_at IS NULL AND m.role<>'client' AND NOT c.is_archived
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION notify_message_mentions() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION notification_membership_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid; entity uuid; module_name text;
BEGIN
 IF TG_TABLE_NAME='project_members' THEN
 SELECT organization_id INTO org FROM projects WHERE id=NEW.project_id; entity:=NEW.project_id;module_name:='projects';
 ELSE SELECT organization_id INTO org FROM channels WHERE id=NEW.channel_id;entity:=NEW.channel_id;module_name:='communication'; END IF;
 PERFORM notify_members(org,ARRAY[NEW.member_id],CASE WHEN module_name='projects' THEN 'project_assigned' ELSE 'channel' END,
 'You have been added to a team','Open your workspace to view the details.',CASE WHEN module_name='projects' THEN 'project' ELSE 'channel' END,entity,
 '/dashboard?module='||module_name||CASE WHEN module_name='projects' THEN '&project=' ELSE '&channel=' END||entity);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION notification_membership_capture() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_project_member ON project_members;
CREATE TRIGGER notification_project_member AFTER INSERT ON project_members FOR EACH ROW EXECUTE FUNCTION notification_membership_capture();
DROP TRIGGER IF EXISTS notification_channel_member ON channel_members;
CREATE TRIGGER notification_channel_member AFTER INSERT ON channel_members FOR EACH ROW EXECUTE FUNCTION notification_membership_capture();

CREATE OR REPLACE FUNCTION notification_milestone_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
 PERFORM notify_members(NEW.organization_id,project_audience(NEW.project_id),'milestone_completed','Project milestone completed','Review the project plan.','project',NEW.project_id,'/dashboard?module=projects&project='||NEW.project_id);
 END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION notification_milestone_capture() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_milestone ON milestones;
CREATE TRIGGER notification_milestone AFTER UPDATE OF completed_at ON milestones FOR EACH ROW EXECUTE FUNCTION notification_milestone_capture();

CREATE OR REPLACE FUNCTION notification_commercial_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('pending_approval','approved','rejected','issued','executed') THEN
 INSERT INTO notifications(organization_id,recipient_id,type,title,body,entity_type,entity_id,link,dedupe_key)
 SELECT NEW.organization_id,NEW.owner_id,'commercial_'||NEW.status,'Commercial document updated','Review the document in Commercial Hub.','commercial',NEW.id,
 '/dashboard?module=crm&commercial='||NEW.id,'commercial:'||NEW.id||':'||NEW.revision||':'||NEW.status
 WHERE NEW.owner_id IS DISTINCT FROM auth_member_id(NEW.organization_id) ON CONFLICT DO NOTHING;
 END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION notification_commercial_capture() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_commercial ON crm_commercial_records;
CREATE TRIGGER notification_commercial AFTER UPDATE OF status ON crm_commercial_records FOR EACH ROW EXECUTE FUNCTION notification_commercial_capture();

-- Task reminders are derived from current records on every sweep, so completion,
-- deletion, rescheduling and reassignment cannot leave stale scheduled jobs.
CREATE OR REPLACE FUNCTION public.notification_sweep_tasks(p_limit integer DEFAULT 200) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE inserted integer;
BEGIN
 WITH candidates AS (
 SELECT t.*,CASE WHEN t.due_date<(now() AT TIME ZONE o.timezone)::date THEN 'task_overdue' ELSE 'task_due' END AS kind
 FROM tasks t JOIN organizations o ON o.id=t.organization_id JOIN organization_members m ON m.id=t.assignee_id
 WHERE t.deleted_at IS NULL AND t.status<>'done' AND t.completed_at IS NULL AND t.due_date IS NOT NULL
 AND t.due_date BETWEEN (now() AT TIME ZONE o.timezone)::date-1 AND (now() AT TIME ZONE o.timezone)::date+1
 AND m.is_active AND m.deleted_at IS NULL AND m.organization_id=t.organization_id
 AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.recipient_id=t.assignee_id AND n.dedupe_key='task:'||t.id||':'||t.due_date||':'||CASE WHEN t.due_date<(now() AT TIME ZONE o.timezone)::date THEN 'task_overdue' ELSE 'task_due' END)
 ORDER BY t.due_date,t.id LIMIT least(greatest(p_limit,1),500) FOR UPDATE OF t SKIP LOCKED
 ), ins AS (
 INSERT INTO notifications(organization_id,recipient_id,type,title,body,entity_type,entity_id,link,dedupe_key,expires_at)
 SELECT organization_id,assignee_id,kind,CASE WHEN kind='task_overdue' THEN 'Task overdue' ELSE 'Task deadline approaching' END,
 'Review your assigned task.','task',id,'/dashboard?module=projects&task='||id,'task:'||id||':'||due_date||':'||kind,now()+interval '1 day' FROM candidates ON CONFLICT DO NOTHING RETURNING 1
 ) SELECT count(*) INTO inserted FROM ins; RETURN inserted;
END $$;
REVOKE ALL ON FUNCTION notification_sweep_tasks(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION notification_sweep_tasks(integer) TO service_role;
