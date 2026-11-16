-- Wake the existing durable queue only after commit. Payload contains no tenant data.
CREATE OR REPLACE FUNCTION public.notification_wake() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM pg_notify('nextmav_notification_jobs',''); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION public.notification_wake() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_wake ON notification_deliveries;
CREATE TRIGGER notification_wake AFTER INSERT ON notification_deliveries
FOR EACH STATEMENT EXECUTE FUNCTION public.notification_wake();

CREATE TABLE IF NOT EXISTS notification_worker_health (
 worker_id text PRIMARY KEY, last_started_at timestamptz NOT NULL DEFAULT now(),
 last_success_at timestamptz, last_sweep_at timestamptz, configuration_ready boolean NOT NULL DEFAULT false
);
ALTER TABLE public.notification_worker_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_worker_health FROM PUBLIC,anon,authenticated;

-- Enrich committed inbox records from actual same-organization source records.
-- Existing notification RLS and dispatch-time source authorization remain authoritative.
CREATE OR REPLACE FUNCTION public.notification_describe() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source record; label text;
BEGIN
 IF NEW.entity_type='message' THEN
   SELECT m.body,m.sender_id,m.parent_id,c.name,p.full_name INTO source
   FROM messages m JOIN channels c ON c.id=m.channel_id AND c.organization_id=m.organization_id
   JOIN organization_members om ON om.id=m.sender_id AND om.organization_id=m.organization_id
   JOIN profiles p ON p.id=om.user_id WHERE m.id=NEW.entity_id AND m.organization_id=NEW.organization_id;
   IF FOUND THEN
     NEW.actor_id:=source.sender_id;
     NEW.title:=coalesce(nullif(source.full_name,''),'A teammate') || CASE WHEN NEW.type='message_mention' THEN ' mentioned you' WHEN source.parent_id IS NOT NULL THEN ' replied' ELSE ' sent you a message' END;
     NEW.body:=left(regexp_replace(regexp_replace(coalesce(source.body,''),'<[^>]*>',' ','g'),'[[:space:]]+',' ','g'),240);
     IF NEW.body='' THEN NEW.body:='Open the conversation to view this message.'; END IF;
     NEW.body:=NEW.body || ' · ' || left(source.name,80);
   END IF;
 ELSIF NEW.entity_type='task' THEN
   SELECT title INTO label FROM tasks WHERE id=NEW.entity_id AND organization_id=NEW.organization_id;
   IF label IS NOT NULL THEN
     NEW.body:=left(label,240);
     IF NEW.type='task_assigned' THEN NEW.title:='New task: '||left(label,100); END IF;
   END IF;
 ELSIF NEW.entity_type='commercial' THEN
   SELECT title INTO label FROM crm_commercial_records WHERE id=NEW.entity_id AND organization_id=NEW.organization_id;
   IF label IS NOT NULL THEN NEW.body:=left(label,240)||' · '||replace(NEW.type,'commercial_',''); END IF;
 ELSIF NEW.entity_type='agreement' THEN
   SELECT title INTO label FROM sign_envelopes WHERE id=NEW.entity_id AND organization_id=NEW.organization_id;
   IF label IS NOT NULL THEN NEW.body:=left(label,240); END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notification_describe() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_z_describe ON notifications;
CREATE TRIGGER notification_z_describe BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION public.notification_describe();

-- Personal test status: never reveal another member's device or delivery data.
CREATE OR REPLACE FUNCTION public.notification_test_status(p_org uuid,p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('state',d.state,'providerCode',d.last_code,'attempts',d.attempts)
 FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id
 WHERE n.id=p_id AND n.organization_id=p_org AND n.recipient_id=auth_member_id(p_org)
 AND n.type='push_test' ORDER BY d.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.notification_test_status(uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.notification_test_status(uuid,bigint) TO authenticated;
