-- Run inside one transaction. Preserve business records and their original RLS policies.
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.crm_automations, public.crm_automation_runs, public.crm_sales_sequences,
 public.crm_sales_enrollments, public.crm_sales_templates, public.crm_mailboxes,
 public.crm_mail_credentials, public.crm_mail_oauth_states, public.crm_mail_messages,
 public.crm_mail_associations, public.crm_mail_outbox IN SHARE ROW EXCLUSIVE MODE;

WITH retired AS (
 UPDATE public.crm_automations a SET status='archived', revision=revision+1, updated_at=now()
 WHERE status<>'archived' AND (a.draft->>'trigger'='sales.sequence_enrolled'
 OR EXISTS (SELECT 1 FROM public.crm_sales_sequences s WHERE s.organization_id=a.organization_id AND s.automation_id=a.id)
 OR EXISTS (SELECT 1 FROM public.crm_automation_versions v WHERE v.organization_id=a.organization_id AND v.id=a.published_version AND v.definition->>'trigger'='sales.sequence_enrolled'))
 RETURNING organization_id,id,revision
)
INSERT INTO public.crm_automation_audit(organization_id,automation_id,revision,operation)
 SELECT organization_id,id,revision,'sales_sequence_retired' FROM retired;

UPDATE public.crm_automation_runs r SET status='cancelled', completed_at=now(),error_code='feature_retired'
 WHERE r.status IN ('pending','waiting','retrying') AND (
 EXISTS (SELECT 1 FROM public.crm_sales_sequences s WHERE s.organization_id=r.organization_id AND s.automation_id=r.automation_id)
 OR EXISTS (SELECT 1 FROM public.crm_automation_versions v WHERE v.organization_id=r.organization_id AND v.id=r.version_id AND v.definition->>'trigger'='sales.sequence_enrolled'));
UPDATE public.crm_sales_enrollments SET state='stopped',stopped_reason='Sales sequences retired',updated_at=now()
 WHERE state IN ('active','paused');
UPDATE public.crm_sales_sequences SET archived=true WHERE NOT archived;

DROP TRIGGER IF EXISTS crm_sales_sequence_task_guard ON public.crm_activities;
DROP TRIGGER IF EXISTS crm_sales_sequence_run_state ON public.crm_automation_runs;
DROP TRIGGER IF EXISTS crm_sales_sequence_immutable ON public.crm_automations;
DROP TRIGGER IF EXISTS crm_mail_association_guard ON public.crm_mail_associations;
DROP TRIGGER IF EXISTS crm_mail_reply_stop ON public.crm_mail_messages;
DROP TRIGGER IF EXISTS crm_mail_association_reconcile ON public.crm_mail_associations;
DROP TRIGGER IF EXISTS crm_mail_association_disconnect ON public.crm_mailboxes;

REVOKE ALL ON public.crm_sales_sequences, public.crm_sales_enrollments, public.crm_sales_templates,
 public.crm_mailboxes, public.crm_mail_associations, public.crm_mail_credentials, public.crm_mail_messages,
 public.crm_mail_oauth_states, public.crm_mail_outbox FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_activity_action(p_org uuid,p_id uuid,p_updated timestamptz,p_action text,p_due timestamptz DEFAULT NULL,p_member uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE a crm_activities%ROWTYPE;
BEGIN
 IF NOT can_access_module(p_org,'crm') OR auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'CRM edit permission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM crm_activities WHERE organization_id=p_org AND id=p_id AND id IN(SELECT id FROM crm_visible_activities WHERE organization_id=p_org) FOR UPDATE;
 IF NOT FOUND OR (a.member_id IS DISTINCT FROM auth_member_id(p_org) AND NOT crm_automation_admin(p_org)) THEN RAISE EXCEPTION 'Activity unavailable' USING ERRCODE='42501'; END IF;
 IF a.updated_at IS DISTINCT FROM p_updated THEN RAISE EXCEPTION 'Activity changed; refresh the queue' USING ERRCODE='PT409'; END IF;
 IF a.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Activity is already completed' USING ERRCODE='PT409'; END IF;
 IF p_action='complete' THEN UPDATE crm_activities SET completed_at=now() WHERE id=p_id AND organization_id=p_org;
 ELSIF p_action='snooze' THEN
  IF p_due IS NULL OR p_due<=now() OR p_due>now()+interval '365 days' THEN RAISE EXCEPTION 'Choose a future due time within one year' USING ERRCODE='22023'; END IF;
  IF a.activity_type='meeting' THEN RAISE EXCEPTION 'Edit the meeting to reschedule its start and end together' USING ERRCODE='22023'; END IF;
  UPDATE crm_activities SET due_at=p_due,remind_at=NULL WHERE id=p_id AND organization_id=p_org;
 ELSIF p_action='reassign' THEN
  IF NOT crm_automation_admin(p_org) THEN RAISE EXCEPTION 'Administrator required to reassign' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM organization_members WHERE id=p_member AND organization_id=p_org AND is_active AND deleted_at IS NULL AND role IN ('owner','administrator','manager','sales_staff')) THEN RAISE EXCEPTION 'Choose an active CRM member' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM organization_members m WHERE m.id=p_member AND m.role='sales_staff') AND
   (a.lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM leads WHERE id=a.lead_id AND organization_id=p_org AND owner_id=p_member AND deleted_at IS NULL)
    OR a.deal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM deals WHERE id=a.deal_id AND organization_id=p_org AND owner_id=p_member AND deleted_at IS NULL)) THEN RAISE EXCEPTION 'Recipient cannot access the linked record' USING ERRCODE='42501'; END IF;
  UPDATE crm_activities SET member_id=p_member WHERE id=p_id AND organization_id=p_org;
 ELSE RAISE EXCEPTION 'Unknown activity action' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.crm_activity_action(uuid,uuid,timestamptz,text,timestamptz,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_activity_action(uuid,uuid,timestamptz,text,timestamptz,uuid) TO authenticated;
DROP FUNCTION IF EXISTS public.crm_mail_acquire(uuid,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.crm_sales_sequence_save(uuid,text,text,jsonb);
DROP FUNCTION IF EXISTS public.crm_sales_sequence_run_state();
DROP FUNCTION IF EXISTS public.crm_sales_sequence_metrics(uuid);
DROP FUNCTION IF EXISTS public.crm_sales_sequence_immutable();
DROP FUNCTION IF EXISTS public.crm_sales_sequence_enroll(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.crm_sales_queue(uuid,text,text,integer);
DROP FUNCTION IF EXISTS public.crm_sales_enrollment_action(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.crm_sales_sequence_task_guard();
DROP FUNCTION IF EXISTS public.crm_sales_activity_action(uuid,uuid,timestamp with time zone,text,timestamp with time zone,uuid);
DROP FUNCTION IF EXISTS public.crm_mail_disconnect(uuid,uuid);
DROP FUNCTION IF EXISTS public.crm_mail_commit_sync(uuid,uuid,jsonb,text[],jsonb);
DROP FUNCTION IF EXISTS public.crm_mail_association_reconcile();
DROP FUNCTION IF EXISTS public.crm_mail_association_guard();
DROP FUNCTION IF EXISTS public.crm_mail_association_disconnect();
DROP FUNCTION IF EXISTS public.crm_mail_associate(uuid,uuid,text,uuid);
DROP FUNCTION IF EXISTS public.crm_mail_activate(uuid,uuid,uuid,text,text,text,text);
DROP FUNCTION IF EXISTS public.crm_mail_reply_stop();
DROP FUNCTION IF EXISTS public.crm_sales_template_save(uuid,uuid,integer,jsonb);
DROP FUNCTION IF EXISTS public.crm_sales_recipient_eligible(uuid,text,uuid);
