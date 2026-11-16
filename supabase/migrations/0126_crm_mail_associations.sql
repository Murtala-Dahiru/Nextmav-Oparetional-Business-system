CREATE TABLE IF NOT EXISTS crm_mail_associations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, mailbox_id uuid NOT NULL,
 thread_id text NOT NULL, record_type text NOT NULL CHECK(record_type IN ('lead','contact')),
 record_id uuid NOT NULL, owner_id uuid NOT NULL REFERENCES organization_members(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(mailbox_id,thread_id),
 FOREIGN KEY(organization_id,mailbox_id) REFERENCES crm_mailboxes(organization_id,id) ON DELETE CASCADE
);
ALTER TABLE crm_mail_associations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_mail_associations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON crm_mail_associations TO authenticated;
GRANT ALL ON crm_mail_associations TO service_role;
DROP POLICY IF EXISTS mail_association_owner_read ON crm_mail_associations;
CREATE POLICY mail_association_owner_read ON crm_mail_associations FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm') AND owner_id=auth_member_id(organization_id));

CREATE OR REPLACE FUNCTION public.crm_mail_associate(p_org uuid,p_message uuid,p_type text,p_record uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE msg crm_mail_messages%ROWTYPE; address text; rid uuid;
BEGIN
 IF NOT can_access_module(p_org,'crm') OR auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'CRM write permission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO msg FROM crm_mail_messages WHERE id=p_message AND organization_id=p_org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Private message unavailable' USING ERRCODE='42501'; END IF;
 IF p_type='lead' THEN SELECT email::text INTO address FROM leads WHERE id=p_record AND organization_id=p_org AND deleted_at IS NULL AND crm_record_visible(organization_id,owner_id);
 ELSIF p_type='contact' THEN SELECT email::text INTO address FROM contacts WHERE id=p_record AND organization_id=p_org AND deleted_at IS NULL;
 ELSE RAISE EXCEPTION 'Choose a lead or contact' USING ERRCODE='22023'; END IF;
 IF nullif(btrim(address),'') IS NULL OR NOT(lower(btrim(address))=lower(btrim(msg.sender)) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(msg.recipients) r WHERE lower(btrim(r))=lower(btrim(address)))) THEN RAISE EXCEPTION 'Selected CRM email must match a message participant' USING ERRCODE='42501'; END IF;
 INSERT INTO crm_mail_associations(organization_id,mailbox_id,thread_id,record_type,record_id,owner_id)
 VALUES(p_org,msg.mailbox_id,msg.thread_id,p_type,p_record,auth_member_id(p_org))
 ON CONFLICT(mailbox_id,thread_id) DO UPDATE SET record_type=EXCLUDED.record_type,record_id=EXCLUDED.record_id,created_at=now() RETURNING id INTO rid;
 RETURN rid;
END $$;
-- The invoker RPC needs write privileges, still guarded by ownership policy.
GRANT INSERT,UPDATE ON crm_mail_associations TO authenticated;
DROP POLICY IF EXISTS mail_association_write ON crm_mail_associations;
CREATE POLICY mail_association_write ON crm_mail_associations FOR ALL TO authenticated USING(owner_id=auth_member_id(organization_id) AND can_access_module(organization_id,'crm')) WITH CHECK(owner_id=auth_member_id(organization_id) AND can_access_module(organization_id,'crm') AND EXISTS(SELECT 1 FROM crm_mailboxes WHERE id=mailbox_id AND organization_id=crm_mail_associations.organization_id AND owner_id=auth_member_id(organization_id)));

-- Revalidate direct writes as well as RPC writes; no polymorphic cross-tenant FK gap.
CREATE OR REPLACE FUNCTION public.crm_mail_association_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE address text;
BEGIN
 IF auth_role_in(NEW.organization_id) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'CRM write permission required' USING ERRCODE='42501'; END IF;
 IF NEW.record_type='lead' THEN SELECT email::text INTO address FROM leads WHERE id=NEW.record_id AND organization_id=NEW.organization_id AND deleted_at IS NULL AND crm_record_visible(organization_id,owner_id);
 ELSE SELECT email::text INTO address FROM contacts WHERE id=NEW.record_id AND organization_id=NEW.organization_id AND deleted_at IS NULL; END IF;
 IF nullif(btrim(address),'') IS NULL OR NOT EXISTS(SELECT 1 FROM crm_mail_messages m WHERE m.mailbox_id=NEW.mailbox_id AND m.organization_id=NEW.organization_id AND m.thread_id=NEW.thread_id AND (lower(btrim(m.sender))=lower(btrim(address)) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(m.recipients) r WHERE lower(btrim(r))=lower(btrim(address))))) THEN RAISE EXCEPTION 'CRM association is unavailable or does not match the private thread' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_mail_association_guard ON crm_mail_associations;
CREATE TRIGGER crm_mail_association_guard BEFORE INSERT OR UPDATE ON crm_mail_associations FOR EACH ROW EXECUTE FUNCTION public.crm_mail_association_guard();

CREATE OR REPLACE FUNCTION public.crm_mail_reply_stop() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE candidate record;
BEGIN
 -- Evaluate the whole bounded thread so out-of-order folder synchronization is safe.
 -- A sender match alone is insufficient. Require an explicitly associated thread,
 -- prior outbound provider evidence, and a message received after enrollment.
 FOR candidate IN SELECT DISTINCT ON(e.id) e.id,e.run_id,e.owner_id,e.organization_id,reply.id AS reply_id FROM crm_mail_associations a
 JOIN crm_mail_messages reply ON reply.mailbox_id=a.mailbox_id AND reply.thread_id=a.thread_id AND reply.direction='inbound'
 JOIN crm_sales_enrollments e ON e.organization_id=a.organization_id AND e.record_type=a.record_type AND e.record_id=a.record_id AND e.owner_id=a.owner_id
 WHERE a.mailbox_id=NEW.mailbox_id AND a.organization_id=NEW.organization_id AND a.thread_id=NEW.thread_id AND e.state IN ('active','paused') AND reply.received_at>e.created_at
 AND EXISTS(SELECT 1 FROM crm_mail_messages sent WHERE sent.mailbox_id=NEW.mailbox_id AND sent.thread_id=NEW.thread_id AND sent.direction='outbound' AND sent.received_at<reply.received_at AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(sent.recipients) r WHERE lower(btrim(r))=lower(btrim(reply.sender))))
 AND (a.record_type='lead' AND EXISTS(SELECT 1 FROM leads l WHERE l.id=a.record_id AND l.organization_id=a.organization_id AND l.deleted_at IS NULL AND lower(btrim(l.email::text))=lower(btrim(reply.sender))) OR a.record_type='contact' AND EXISTS(SELECT 1 FROM contacts c WHERE c.id=a.record_id AND c.organization_id=a.organization_id AND c.deleted_at IS NULL AND lower(btrim(c.email::text))=lower(btrim(reply.sender))))
 ORDER BY e.id,reply.received_at DESC
 LOOP
  PERFORM 1 FROM crm_automation_runs WHERE id=candidate.run_id FOR UPDATE;
  UPDATE crm_sales_enrollments SET state='replied',stopped_reason='provider_thread_reply',updated_at=now() WHERE id=candidate.id AND state IN ('active','paused');
  IF FOUND THEN
   UPDATE crm_automation_runs SET status='cancelled',completed_at=now() WHERE id=candidate.run_id;
   INSERT INTO notifications(organization_id,recipient_id,type,title,body,entity_type,entity_id) VALUES(candidate.organization_id,candidate.owner_id,'crm_automation','Customer reply stopped a sales sequence','Review the private mailbox conversation in Sales Engagement.','crm_mail_message',candidate.reply_id);
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_mail_reply_stop ON crm_mail_messages;
CREATE TRIGGER crm_mail_reply_stop AFTER INSERT OR UPDATE ON crm_mail_messages FOR EACH ROW EXECUTE FUNCTION public.crm_mail_reply_stop();
REVOKE ALL ON FUNCTION public.crm_mail_associate(uuid,uuid,text,uuid),public.crm_mail_association_guard(),public.crm_mail_reply_stop() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mail_associate(uuid,uuid,text,uuid) TO authenticated;

-- Re-evaluate existing provider evidence when the owner explicitly associates a thread.
CREATE OR REPLACE FUNCTION public.crm_mail_association_reconcile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE crm_mail_messages SET subject=subject WHERE id=(SELECT id FROM crm_mail_messages WHERE mailbox_id=NEW.mailbox_id AND thread_id=NEW.thread_id ORDER BY received_at DESC LIMIT 1);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_mail_association_reconcile ON crm_mail_associations;
CREATE TRIGGER crm_mail_association_reconcile AFTER INSERT OR UPDATE ON crm_mail_associations FOR EACH ROW EXECUTE FUNCTION public.crm_mail_association_reconcile();
CREATE OR REPLACE FUNCTION public.crm_mail_association_disconnect() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.state='disconnected' THEN DELETE FROM crm_mail_associations WHERE mailbox_id=NEW.id; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_mail_association_disconnect ON crm_mailboxes;
CREATE TRIGGER crm_mail_association_disconnect AFTER UPDATE ON crm_mailboxes FOR EACH ROW EXECUTE FUNCTION public.crm_mail_association_disconnect();
REVOKE ALL ON FUNCTION public.crm_mail_association_reconcile(),public.crm_mail_association_disconnect() FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS crm_mail_message_thread ON crm_mail_messages(mailbox_id,thread_id,received_at);
