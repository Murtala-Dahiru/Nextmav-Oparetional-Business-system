CREATE TABLE IF NOT EXISTS sign_reminders (
 envelope_id uuid NOT NULL REFERENCES sign_envelopes(id),due_on date NOT NULL,
 activity_id uuid NOT NULL REFERENCES crm_activities(id),PRIMARY KEY(envelope_id,due_on)
);
ALTER TABLE sign_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sign_reminders FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sign_remind(p_id uuid,p_due date) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e sign_envelopes%ROWTYPE; result uuid;
BEGIN
 SELECT * INTO e FROM sign_envelopes WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT crm_record_visible(e.organization_id,e.owner_id) OR NOT can_access_module(e.organization_id,'crm') OR (e.record_id IS NOT NULL AND NOT crm_commercial_visible(e.organization_id,e.record_id)) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF e.status NOT IN ('sent','in_progress') OR p_due<current_date OR p_due>current_date+365 THEN RAISE EXCEPTION 'Invalid follow-up';END IF;
 SELECT activity_id INTO result FROM sign_reminders WHERE envelope_id=p_id AND due_on=p_due;
 IF result IS NOT NULL THEN RETURN result;END IF;
 INSERT INTO crm_activities(organization_id,activity_type,subject,member_id,due_at)
 VALUES(e.organization_id,'followup','Follow up on agreement: '||left(e.title,150),e.owner_id,p_due::timestamp AT TIME ZONE 'UTC') RETURNING id INTO result;
 INSERT INTO sign_reminders VALUES(p_id,p_due,result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sign_remind(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sign_remind(uuid,date) TO authenticated;
CREATE OR REPLACE FUNCTION public.sign_overview(p_org uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
 'total',count(*),'completed',count(*) FILTER(WHERE status='completed'),
 'declined',count(*) FILTER(WHERE status='declined'),
 'draft',count(*) FILTER(WHERE status='draft'),
 'pending',count(*) FILTER(WHERE status IN ('sent','in_progress')),
 'expiring',count(*) FILTER(WHERE status IN ('sent','in_progress') AND (data->>'expiresAt')::timestamptz BETWEEN now() AND now()+interval '7 days'),
 'expired',count(*) FILTER(WHERE status IN ('sent','in_progress') AND (data->>'expiresAt')::timestamptz<now()),
 'failed',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(data->'events') v WHERE v->>'type'='invitation.failed'))
 ) FROM sign_envelopes WHERE organization_id=p_org
$$;
REVOKE ALL ON FUNCTION public.sign_overview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sign_overview(uuid) TO authenticated;
