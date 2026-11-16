CREATE OR REPLACE FUNCTION public.notification_claim(p_org uuid DEFAULT NULL) RETURNS SETOF notification_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job notification_deliveries%ROWTYPE;
BEGIN
 WITH candidate AS (
 SELECT id FROM notification_deliveries WHERE (p_org IS NULL OR organization_id=p_org)
 AND ((state='pending' AND available_at<=now()) OR (state='processing' AND lease_until<now()))
 ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1
 ) UPDATE notification_deliveries j SET failures=failures+CASE WHEN state='processing' THEN 1 ELSE 0 END,
 state='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1
 FROM candidate c WHERE j.id=c.id RETURNING j.* INTO job;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE notification_delivery_attempts SET finished_at=now(),result='lease_expired' WHERE delivery_id=job.id AND finished_at IS NULL;
 INSERT INTO notification_delivery_attempts(organization_id,delivery_id,attempt) VALUES(job.organization_id,job.id,job.attempts);
 RETURN NEXT job;
END $$;
REVOKE ALL ON FUNCTION public.notification_claim(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notification_claim(uuid) TO service_role;
