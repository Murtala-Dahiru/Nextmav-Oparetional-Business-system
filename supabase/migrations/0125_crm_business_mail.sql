-- Mailbox contents are private to the connecting membership, including for admins.
CREATE TABLE IF NOT EXISTS crm_mailboxes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 owner_id uuid NOT NULL REFERENCES organization_members(id), provider text NOT NULL CHECK(provider IN ('google','microsoft')),
 address text NOT NULL, provider_account_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('connected','reauthorization_required','error','disconnected')),
 last_sync_at timestamptz, error_code text, retry_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,owner_id,provider,provider_account_id), UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS crm_mail_credentials (
 mailbox_id uuid PRIMARY KEY REFERENCES crm_mailboxes(id) ON DELETE CASCADE,
 encrypted_tokens text NOT NULL, sync_state jsonb NOT NULL DEFAULT '{}',
 lease_id uuid, lease_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_mail_oauth_states (
 state_hash text PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), owner_id uuid NOT NULL REFERENCES organization_members(id),
 user_id uuid NOT NULL REFERENCES profiles(id), provider text NOT NULL CHECK(provider IN ('google','microsoft')),
 encrypted_verifier text NOT NULL, browser_hash text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_mail_oauth_expiry ON crm_mail_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS crm_mail_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, mailbox_id uuid NOT NULL,
 provider_id text NOT NULL, thread_id text NOT NULL, internet_message_id text, in_reply_to text,
 sender text NOT NULL, recipients jsonb NOT NULL DEFAULT '[]', cc jsonb NOT NULL DEFAULT '[]',
 subject text NOT NULL, body_text text NOT NULL CHECK(octet_length(body_text)<=200000),
 received_at timestamptz NOT NULL, direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
 has_attachments boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,mailbox_id) REFERENCES crm_mailboxes(organization_id,id) ON DELETE CASCADE,
 UNIQUE(mailbox_id,provider_id)
);
CREATE INDEX IF NOT EXISTS crm_mail_thread_order ON crm_mail_messages(mailbox_id,thread_id,received_at DESC,id);
CREATE INDEX IF NOT EXISTS crm_mail_inbox_order ON crm_mail_messages(mailbox_id,received_at DESC,id);
CREATE TABLE IF NOT EXISTS crm_mail_outbox (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, mailbox_id uuid NOT NULL,
 payload_hash text NOT NULL, state text NOT NULL CHECK(state IN ('sending','accepted','failed','unknown')),
 provider_message_id text, error_code text, created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz,
 FOREIGN KEY(organization_id,mailbox_id) REFERENCES crm_mailboxes(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_mail_sending_limit ON crm_mail_outbox(mailbox_id,created_at);
ALTER TABLE crm_mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_mail_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_mail_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_mail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_mail_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_mailboxes,crm_mail_credentials,crm_mail_oauth_states,crm_mail_messages,crm_mail_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT ON crm_mailboxes,crm_mail_messages,crm_mail_outbox TO authenticated;
GRANT ALL ON crm_mailboxes,crm_mail_credentials,crm_mail_oauth_states,crm_mail_messages,crm_mail_outbox TO service_role;
DROP POLICY IF EXISTS mailbox_owner_read ON crm_mailboxes;
CREATE POLICY mailbox_owner_read ON crm_mailboxes FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm') AND owner_id=auth_member_id(organization_id));
DROP POLICY IF EXISTS mailbox_message_read ON crm_mail_messages;
CREATE POLICY mailbox_message_read ON crm_mail_messages FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM crm_mailboxes m WHERE m.id=mailbox_id AND m.organization_id=crm_mail_messages.organization_id AND m.owner_id=auth_member_id(m.organization_id)));
DROP POLICY IF EXISTS mailbox_outbox_read ON crm_mail_outbox;
CREATE POLICY mailbox_outbox_read ON crm_mail_outbox FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM crm_mailboxes m WHERE m.id=mailbox_id AND m.organization_id=crm_mail_outbox.organization_id AND m.owner_id=auth_member_id(m.organization_id)));

-- Lease acquisition serializes refresh, synchronization, send and disconnect.
CREATE OR REPLACE FUNCTION public.crm_mail_acquire(p_id uuid,p_org uuid,p_owner uuid,p_lease uuid)
RETURNS SETOF crm_mail_credentials LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crm_mailboxes m JOIN organization_members u ON u.id=m.owner_id JOIN profiles p ON p.id=u.user_id WHERE m.id=p_id AND m.organization_id=p_org AND m.owner_id=p_owner AND m.state<>'disconnected' AND u.is_active AND u.deleted_at IS NULL AND p.is_active AND p.auth_deleted_at IS NULL) THEN RETURN; END IF;
 RETURN QUERY UPDATE crm_mail_credentials SET lease_id=p_lease,lease_until=now()+interval '5 minutes' WHERE mailbox_id=p_id AND (lease_until IS NULL OR lease_until<now()) RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION public.crm_mail_commit_sync(p_id uuid,p_lease uuid,p_messages jsonb,p_deleted text[],p_state jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE org uuid; message jsonb;
BEGIN
 PERFORM 1 FROM crm_mail_credentials WHERE mailbox_id=p_id AND lease_id=p_lease AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mailbox lease expired' USING ERRCODE='PT409'; END IF;
 SELECT organization_id INTO STRICT org FROM crm_mailboxes WHERE id=p_id AND state='connected';
 IF jsonb_typeof(p_messages) IS DISTINCT FROM 'array' OR jsonb_array_length(p_messages)>100 THEN RAISE EXCEPTION 'Sync batch exceeded' USING ERRCODE='22023'; END IF;
 FOR message IN SELECT value FROM jsonb_array_elements(p_messages) LOOP
  INSERT INTO crm_mail_messages(organization_id,mailbox_id,provider_id,thread_id,internet_message_id,in_reply_to,sender,recipients,cc,subject,body_text,received_at,direction,has_attachments)
  VALUES(org,p_id,message->>'id',message->>'threadId',message->>'internetMessageId',message->>'inReplyTo',message->>'from',message->'to',message->'cc',message->>'subject',message->>'text',(message->>'receivedAt')::timestamptz,message->>'direction',coalesce((message->>'hasAttachments')::boolean,false))
  ON CONFLICT(mailbox_id,provider_id) DO UPDATE SET thread_id=EXCLUDED.thread_id,sender=EXCLUDED.sender,recipients=EXCLUDED.recipients,cc=EXCLUDED.cc,subject=EXCLUDED.subject,body_text=EXCLUDED.body_text,received_at=EXCLUDED.received_at,has_attachments=EXCLUDED.has_attachments;
 END LOOP;
 DELETE FROM crm_mail_messages WHERE mailbox_id=p_id AND provider_id=ANY(p_deleted);
 UPDATE crm_mail_credentials SET sync_state=p_state,updated_at=now() WHERE mailbox_id=p_id;
 UPDATE crm_mailboxes SET last_sync_at=now(),error_code=NULL,retry_at=NULL WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_mail_disconnect(p_id uuid,p_lease uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM crm_mail_credentials WHERE mailbox_id=p_id AND lease_id=p_lease AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mailbox lease expired' USING ERRCODE='PT409'; END IF;
 DELETE FROM crm_mail_messages WHERE mailbox_id=p_id;
 DELETE FROM crm_mail_outbox WHERE mailbox_id=p_id;
 DELETE FROM crm_mail_credentials WHERE mailbox_id=p_id;
 UPDATE crm_mailboxes SET state='disconnected',last_sync_at=NULL,error_code=NULL,retry_at=NULL WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.crm_mail_acquire(uuid,uuid,uuid,uuid),public.crm_mail_commit_sync(uuid,uuid,jsonb,text[],jsonb),public.crm_mail_disconnect(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mail_acquire(uuid,uuid,uuid,uuid),public.crm_mail_commit_sync(uuid,uuid,jsonb,text[],jsonb),public.crm_mail_disconnect(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_mail_activate(p_id uuid,p_org uuid,p_owner uuid,p_provider text,p_address text,p_account text,p_encrypted text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_state text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||p_owner::text||p_provider||p_account,0));
 SELECT state INTO current_state FROM crm_mailboxes WHERE id=p_id AND organization_id=p_org AND owner_id=p_owner FOR UPDATE;
 IF FOUND AND current_state<>'disconnected' THEN RAISE EXCEPTION 'Disconnect existing mailbox first' USING ERRCODE='PT409'; END IF;
 INSERT INTO crm_mailboxes(id,organization_id,owner_id,provider,address,provider_account_id,state) VALUES(p_id,p_org,p_owner,p_provider,p_address,p_account,'connected')
 ON CONFLICT(id) DO UPDATE SET state='connected',address=EXCLUDED.address,error_code=NULL,retry_at=NULL;
 INSERT INTO crm_mail_credentials(mailbox_id,encrypted_tokens) VALUES(p_id,p_encrypted)
 ON CONFLICT(mailbox_id) DO UPDATE SET encrypted_tokens=EXCLUDED.encrypted_tokens,sync_state='{}',lease_id=NULL,lease_until=NULL,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.crm_mail_activate(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mail_activate(uuid,uuid,uuid,text,text,text,text) TO service_role;
