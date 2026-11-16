-- Service-only queue and operational ledger. Explicit deny, including when future grants change.
DROP POLICY IF EXISTS queue_private ON notification_deliveries;
CREATE POLICY queue_private ON notification_deliveries AS RESTRICTIVE FOR ALL TO authenticated USING(false) WITH CHECK(false);
DROP POLICY IF EXISTS attempts_private ON notification_delivery_attempts;
CREATE POLICY attempts_private ON notification_delivery_attempts AS RESTRICTIVE FOR ALL TO authenticated USING(false) WITH CHECK(false);

CREATE OR REPLACE FUNCTION public.notification_expense_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','rejected','reimbursed') THEN
 PERFORM notify_members(NEW.organization_id,ARRAY[NEW.submitted_by],'expense_'||NEW.status,'Expense request updated','Review the decision in Finance.','expense',NEW.id,'/dashboard?module=finance&tab=expenses&expense='||NEW.id);
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_expense_decision ON expenses;
CREATE TRIGGER notification_expense_decision AFTER UPDATE OF status ON expenses FOR EACH ROW EXECUTE FUNCTION public.notification_expense_decision();

CREATE OR REPLACE FUNCTION public.notification_ticket_attention() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.assignee_id IS NOT NULL THEN
 PERFORM notify_members(NEW.organization_id,ARRAY[NEW.assignee_id],'ticket_assigned','Support ticket assigned','Review the ticket in Support.','ticket',NEW.id,'/dashboard?module=support&ticket='||NEW.id);
 ELSIF TG_OP='UPDATE' AND NEW.priority IS DISTINCT FROM OLD.priority AND NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN
 PERFORM notify_members(NEW.organization_id,ARRAY[NEW.assignee_id],'ticket_priority','Ticket priority changed','Review your assigned ticket.','ticket',NEW.id,'/dashboard?module=support&ticket='||NEW.id);
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_ticket_attention ON support_tickets;
CREATE TRIGGER notification_ticket_attention AFTER INSERT OR UPDATE OF priority ON support_tickets FOR EACH ROW EXECUTE FUNCTION public.notification_ticket_attention();

CREATE OR REPLACE FUNCTION public.notification_ticket_response() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t support_tickets%ROWTYPE;
BEGIN
 SELECT * INTO t FROM support_tickets WHERE id=NEW.ticket_id AND deleted_at IS NULL;
 IF FOUND AND NOT NEW.is_internal AND NEW.author_id=t.requester_id THEN
 PERFORM notify_members(t.organization_id,ARRAY[t.assignee_id],'ticket_response','New ticket response','A requester replied to your assigned ticket.','ticket',t.id,'/dashboard?module=support&ticket='||t.id);
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_ticket_response ON ticket_comments;
CREATE TRIGGER notification_ticket_response AFTER INSERT ON ticket_comments FOR EACH ROW EXECUTE FUNCTION public.notification_ticket_response();

CREATE OR REPLACE FUNCTION public.notification_crm_activity_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.member_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.member_id IS DISTINCT FROM OLD.member_id) AND NEW.completed_at IS NULL THEN
 PERFORM notify_members(NEW.organization_id,ARRAY[NEW.member_id],'crm_activity_assigned','CRM activity assigned','Review your assigned activity.','crm_activity',NEW.id,'/dashboard?module=crm&tab=activities');
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_crm_activity_assignment ON crm_activities;
CREATE TRIGGER notification_crm_activity_assignment AFTER INSERT OR UPDATE OF member_id ON crm_activities FOR EACH ROW EXECUTE FUNCTION public.notification_crm_activity_assignment();

CREATE OR REPLACE FUNCTION public.notification_stage_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE recipients uuid[];
BEGIN
 IF TG_OP='INSERT' AND NEW.status='pending' THEN
 recipients:=members_with_roles(NEW.organization_id,ARRAY['owner','administrator']::org_role[]);
 ELSIF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','rejected') THEN recipients:=ARRAY[NEW.requested_by];
 ELSE RETURN NEW; END IF;
 PERFORM notify_members(NEW.organization_id,recipients,'deal_approval_'||NEW.status,'Deal approval updated','Review the opportunity in CRM.','deal',NEW.deal_id,'/dashboard?module=crm&deal='||NEW.deal_id);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_stage_approval ON crm_stage_approvals;
CREATE TRIGGER notification_stage_approval AFTER INSERT OR UPDATE OF status ON crm_stage_approvals FOR EACH ROW EXECUTE FUNCTION public.notification_stage_approval();

CREATE OR REPLACE FUNCTION public.notification_commercial_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE targets uuid[];
BEGIN
 IF NEW.status=OLD.status OR NEW.status NOT IN ('pending_approval','approved','changes_requested','rejected','issued','accepted','declined','executed','sent_for_signature') THEN RETURN NEW; END IF;
 IF NEW.status='pending_approval' THEN
 SELECT array_agg(m.id) INTO targets FROM organization_members m LEFT JOIN crm_commercial_policies p ON p.organization_id=m.organization_id
 WHERE m.organization_id=NEW.organization_id AND m.is_active AND m.deleted_at IS NULL AND m.role::text=ANY(coalesce(p.approver_roles,ARRAY['owner','administrator']))
 AND (coalesce(p.allow_self_approval,false) OR (m.id<>NEW.owner_id AND m.id<>NEW.created_by AND m.id IS DISTINCT FROM NEW.submitted_by))
 -- Scope managers and sales roles to their own record. Owner/administrator may review across the org.
 AND (m.role IN ('owner','administrator') OR m.id=NEW.owner_id);
 ELSE targets:=ARRAY[NEW.owner_id]; END IF;
 INSERT INTO notifications(organization_id,recipient_id,type,title,body,entity_type,entity_id,link,dedupe_key)
 SELECT NEW.organization_id,recipient,'commercial_'||NEW.status,'Commercial document updated','Review the document in Commercial Hub.','commercial',NEW.id,
 '/dashboard?module=crm&commercial='||NEW.id,'commercial:'||NEW.id||':'||NEW.revision||':'||NEW.status FROM unnest(targets) recipient ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notification_sign_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE action jsonb; kind text;
BEGIN
 -- Completion and decline are already captured by sign_capture. Add their missing destination in notification_prepare below.
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('sent','revoked','expired') THEN
 PERFORM notify_members(NEW.organization_id,ARRAY[NEW.owner_id],'sign_'||NEW.status,'Signing request '||NEW.status,'Review the request in NextMav Sign.','agreement',NEW.id,'/dashboard?module=crm&agreement='||NEW.id);
 END IF;
 IF NEW.data->'actions' IS DISTINCT FROM OLD.data->'actions' THEN
 FOR action IN SELECT value FROM jsonb_array_elements(coalesce(NEW.data->'actions','[]'::jsonb)) WHERE value->>'action' IN ('signed','approved') LOOP
 kind:=CASE WHEN action->>'recipientRole'='witness' THEN 'witness_signed' ELSE 'recipient_'||(action->>'action') END;
 INSERT INTO notifications(organization_id,recipient_id,type,title,body,entity_type,entity_id,link,dedupe_key)
 VALUES(NEW.organization_id,NEW.owner_id,'sign_'||kind,'Signing progress updated','Review the agreement in NextMav Sign.','agreement',NEW.id,'/dashboard?module=crm&agreement='||NEW.id,'sign:'||NEW.id||':'||(action->>'recipientId')||':'||kind) ON CONFLICT DO NOTHING;
 END LOOP; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_sign_lifecycle ON sign_envelopes;
CREATE TRIGGER notification_sign_lifecycle AFTER UPDATE OF status,data ON sign_envelopes FOR EACH ROW EXECUTE FUNCTION public.notification_sign_lifecycle();

CREATE OR REPLACE FUNCTION public.notification_task_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='review' AND NEW.status IS DISTINCT FROM OLD.status THEN
 PERFORM notify_members(NEW.organization_id,ARRAY[NEW.reporter_id],'task_review','Task ready for review','Review the task in Projects.','task',NEW.id,'/dashboard?module=projects&task='||NEW.id);
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_task_review ON tasks;
CREATE TRIGGER notification_task_review AFTER UPDATE OF status ON tasks FOR EACH ROW EXECUTE FUNCTION public.notification_task_review();
REVOKE ALL ON FUNCTION public.notification_expense_decision(),public.notification_ticket_attention(),public.notification_ticket_response(),public.notification_crm_activity_assignment(),public.notification_stage_approval(),public.notification_sign_lifecycle(),public.notification_task_review() FROM PUBLIC,anon,authenticated;

-- Enforce the provider allowlist on the stored value as well as registration.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notification_device_provider' AND conrelid='notification_devices'::regclass) THEN
 ALTER TABLE notification_devices ADD CONSTRAINT notification_device_provider CHECK (
 endpoint ~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/[^[:space:]]+$'
 );
 END IF;
END $$;

-- Existing read policy verifies mailbox ownership. Also recheck record access
-- for notifications whose original targets may have changed.
DROP POLICY IF EXISTS notification_current_access ON notifications;
CREATE POLICY notification_current_access ON notifications AS RESTRICTIVE FOR SELECT TO authenticated USING (
 CASE WHEN entity_type IN ('message','channel','commercial','agreement','lead','deal','ticket','leave_request','hr_case','expense','project','invoice')
 THEN notification_record_visible(organization_id,type,entity_type,entity_id) ELSE true END
);
