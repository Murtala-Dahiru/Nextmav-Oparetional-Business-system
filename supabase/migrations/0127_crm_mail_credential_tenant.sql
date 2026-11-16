-- Explicit tenant binding also protects service-side credential writes.
ALTER TABLE crm_mail_credentials ADD COLUMN IF NOT EXISTS organization_id uuid;
UPDATE crm_mail_credentials c SET organization_id=m.organization_id FROM crm_mailboxes m WHERE m.id=c.mailbox_id AND c.organization_id IS NULL;
ALTER TABLE crm_mail_credentials ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE crm_mail_credentials DROP CONSTRAINT IF EXISTS crm_mail_credentials_tenant;
ALTER TABLE crm_mail_credentials ADD CONSTRAINT crm_mail_credentials_tenant FOREIGN KEY(organization_id,mailbox_id) REFERENCES crm_mailboxes(organization_id,id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION public.crm_mail_activate(p_id uuid,p_org uuid,p_owner uuid,p_provider text,p_address text,p_account text,p_encrypted text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_state text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||p_owner::text||p_provider||p_account,0));
 SELECT state INTO current_state FROM crm_mailboxes WHERE id=p_id AND organization_id=p_org AND owner_id=p_owner FOR UPDATE;
 IF FOUND AND current_state<>'disconnected' THEN RAISE EXCEPTION 'Disconnect existing mailbox first' USING ERRCODE='PT409'; END IF;
 INSERT INTO crm_mailboxes(id,organization_id,owner_id,provider,address,provider_account_id,state) VALUES(p_id,p_org,p_owner,p_provider,p_address,p_account,'connected')
 ON CONFLICT(id) DO UPDATE SET state='connected',address=EXCLUDED.address,error_code=NULL,retry_at=NULL;
 INSERT INTO crm_mail_credentials(mailbox_id,organization_id,encrypted_tokens) VALUES(p_id,p_org,p_encrypted)
 ON CONFLICT(mailbox_id) DO UPDATE SET encrypted_tokens=EXCLUDED.encrypted_tokens,sync_state='{}',lease_id=NULL,lease_until=NULL,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.crm_mail_activate(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mail_activate(uuid,uuid,uuid,text,text,text,text) TO service_role;
