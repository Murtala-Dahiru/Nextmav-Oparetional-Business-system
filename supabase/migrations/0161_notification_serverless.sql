CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Existing infrastructure: pg_net delivers wake-ups after commit; the existing
-- durable queue, not pg_net, owns delivery, retries, leases and deduplication.
CREATE TABLE IF NOT EXISTS notification_dispatch_requests (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request_id bigint, requested_at timestamptz NOT NULL DEFAULT now(), error_code text
);
ALTER TABLE notification_dispatch_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_dispatch_requests FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.notification_request_dispatch() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE destination text; credential text; request bigint;
BEGIN
 -- Missing extensions/configuration must never roll back a business event.
 IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regnamespace('net') IS NULL THEN RETURN NULL; END IF;
 SELECT decrypted_secret INTO destination FROM vault.decrypted_secrets WHERE name='notification_dispatch_url';
 SELECT decrypted_secret INTO credential FROM vault.decrypted_secrets WHERE name='notification_dispatch_secret';
 IF destination IS NULL OR credential IS NULL THEN RETURN NULL; END IF;
 IF destination !~ '^https://[a-zA-Z0-9.-]+/api/internal/notifications/dispatch$' OR length(credential)<32 THEN
   INSERT INTO notification_dispatch_requests(error_code) VALUES('invalid_configuration'); RETURN NULL;
 END IF;
 IF current_setting('nextmav.dispatch_requested',true)='yes' THEN RETURN NULL; END IF;
 PERFORM set_config('nextmav.dispatch_requested','yes',true);
 SELECT net.http_post(url:=destination,body:='{}'::jsonb,
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||credential),
   timeout_milliseconds:=280000) INTO request;
 INSERT INTO notification_dispatch_requests(request_id) VALUES(request);
 RETURN request;
EXCEPTION WHEN OTHERS THEN
 INSERT INTO notification_dispatch_requests(error_code) VALUES(SQLSTATE);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.notification_request_dispatch() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.notification_wake() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 -- The transition table prevents recursive empty INSERT statements in reminder
 -- sweeps from scheduling more functions indefinitely.
 IF EXISTS(SELECT 1 FROM new_deliveries) THEN
   PERFORM pg_notify('nextmav_notification_jobs','');
   PERFORM public.notification_request_dispatch();
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.notification_wake() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_wake ON notification_deliveries;
CREATE TRIGGER notification_wake AFTER INSERT ON notification_deliveries
REFERENCING NEW TABLE AS new_deliveries FOR EACH STATEMENT EXECUTE FUNCTION public.notification_wake();

-- Invoked by Supabase Cron. Immediate events use the trigger above; this is only
-- the recovery/reminder path. Vault secrets are never embedded in cron.job.
CREATE OR REPLACE FUNCTION public.notification_dispatch_tick() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM sweep_todo_reminders(200);
 PERFORM sweep_crm_reminders(200);
 PERFORM notification_sweep_tasks(200);
 PERFORM notification_sweep_deadlines(200);
 IF EXISTS(SELECT 1 FROM notification_deliveries WHERE
   (state='pending' AND available_at<=now()) OR (state='processing' AND lease_until<now())) THEN
   PERFORM public.notification_request_dispatch();
 END IF;
 INSERT INTO notification_worker_health(worker_id,last_success_at,last_sweep_at,configuration_ready) VALUES('scheduler',now(),now(),true)
 ON CONFLICT(worker_id) DO UPDATE SET last_success_at=now(),last_sweep_at=now();
 DELETE FROM notification_dispatch_requests WHERE requested_at<now()-interval '7 days';
END $$;
REVOKE ALL ON FUNCTION public.notification_dispatch_tick() FROM PUBLIC,anon,authenticated;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
   IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='nextmav-push-recovery') THEN
     PERFORM cron.schedule('nextmav-push-recovery','* * * * *','SELECT public.notification_dispatch_tick()');
   END IF;
 END IF;
END $$;

-- Explicit deny policies document the operator-only boundary. No grants to browsers.
DROP POLICY IF EXISTS notification_worker_health_deny ON public.notification_worker_health;
CREATE POLICY notification_worker_health_deny ON public.notification_worker_health FOR ALL TO authenticated USING(false) WITH CHECK(false);
DROP POLICY IF EXISTS notification_dispatch_requests_deny ON public.notification_dispatch_requests;
CREATE POLICY notification_dispatch_requests_deny ON public.notification_dispatch_requests FOR ALL TO authenticated USING(false) WITH CHECK(false);
