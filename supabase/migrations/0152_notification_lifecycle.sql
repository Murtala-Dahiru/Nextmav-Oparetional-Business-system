-- Reading a conversation reconciles the shared tray and cancels queued alerts
-- through the dispatcher's existing is_read check.
CREATE OR REPLACE FUNCTION public.notification_channel_read() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.last_read_at>OLD.last_read_at THEN
 UPDATE notifications n SET is_read=true,read_at=now()
 FROM messages m WHERE n.recipient_id=NEW.member_id AND n.entity_type='message' AND n.entity_id=m.id
 AND m.channel_id=NEW.channel_id AND m.created_at<=NEW.last_read_at AND NOT n.is_read;
 END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notification_channel_read() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_channel_read ON channel_members;
CREATE TRIGGER notification_channel_read AFTER UPDATE OF last_read_at ON channel_members FOR EACH ROW EXECUTE FUNCTION public.notification_channel_read();
GRANT UPDATE(enabled) ON notification_devices TO authenticated;

-- Task scheduling remains useful without a Web Push transport. As with existing
-- reminder migrations, environments without pg_cron use the bounded CLI worker.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
   IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='nextmav-task-notifications') THEN
     PERFORM cron.schedule('nextmav-task-notifications','* * * * *','SELECT public.notification_sweep_tasks(200)');
   END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notification_retention(p_days integer DEFAULT 90) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE removed integer;
BEGIN
 IF p_days<30 OR p_days>3650 THEN RAISE EXCEPTION 'Retention must be 30–3650 days' USING ERRCODE='22023'; END IF;
 WITH expired AS (SELECT id FROM notifications WHERE created_at<now()-make_interval(days=>p_days) AND is_read ORDER BY id LIMIT 1000 FOR UPDATE SKIP LOCKED)
 DELETE FROM notifications n USING expired e WHERE n.id=e.id;
 GET DIAGNOSTICS removed=ROW_COUNT;
 DELETE FROM notification_delivery_attempts WHERE started_at<now()-interval '30 days' AND finished_at IS NOT NULL;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.notification_retention(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notification_retention(integer) TO service_role;
