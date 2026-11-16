-- Keep reminders attached to an authorized CRM customer.
CREATE OR REPLACE FUNCTION public.sign_remind(p_id uuid,p_due date) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e sign_envelopes%ROWTYPE; result uuid; company uuid;
BEGIN
 SELECT * INTO e FROM sign_envelopes WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT crm_record_visible(e.organization_id,e.owner_id) OR NOT can_access_module(e.organization_id,'crm') OR (e.record_id IS NOT NULL AND NOT crm_commercial_visible(e.organization_id,e.record_id)) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF e.status NOT IN ('sent','in_progress') OR p_due<current_date OR p_due>current_date+365 THEN RAISE EXCEPTION 'Invalid follow-up';END IF;
 SELECT activity_id INTO result FROM sign_reminders WHERE envelope_id=p_id AND due_on=p_due;
 IF result IS NOT NULL THEN RETURN result;END IF;
 SELECT company_id INTO company FROM crm_commercial_records WHERE id=e.record_id AND organization_id=e.organization_id;
 IF company IS NULL THEN RAISE EXCEPTION 'Owner CRM follow-ups require a linked commercial customer'; END IF;
 INSERT INTO crm_activities(organization_id,activity_type,subject,member_id,due_at,company_id)
 VALUES(e.organization_id,'followup','Follow up on agreement: '||left(e.title,150),e.owner_id,p_due::timestamp AT TIME ZONE 'UTC',company) RETURNING id INTO result;
 INSERT INTO sign_reminders VALUES(p_id,p_due,result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sign_remind(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sign_remind(uuid,date) TO authenticated;
