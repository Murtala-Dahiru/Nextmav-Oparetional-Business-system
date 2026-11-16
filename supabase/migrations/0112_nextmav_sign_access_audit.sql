-- Access lifecycle is separate from immutable execution evidence. Completed
-- documents remain retained when recipient capabilities are revoked.
CREATE TABLE IF NOT EXISTS sign_access_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 envelope_id uuid NOT NULL,recipient_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES organization_members(id),
 operation text NOT NULL CHECK(operation='recipient_access_revoked'),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,envelope_id) REFERENCES sign_envelopes(organization_id,id)
);
ALTER TABLE sign_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sign_access_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON sign_access_audit TO authenticated;
CREATE POLICY sign_access_audit_read ON sign_access_audit FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM sign_envelopes e WHERE e.id=envelope_id AND e.organization_id=sign_access_audit.organization_id));
CREATE OR REPLACE FUNCTION public.sign_revoke_recipient(p_id uuid,p_recipient uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e sign_envelopes%ROWTYPE;
BEGIN
 SELECT * INTO e FROM sign_envelopes WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT crm_record_visible(e.organization_id,e.owner_id) OR (e.record_id IS NOT NULL AND NOT crm_commercial_visible(e.organization_id,e.record_id)) OR auth_member_id(e.organization_id) IS NULL THEN RAISE EXCEPTION 'Agreement unavailable' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.data->'recipients') r WHERE r->>'id'=p_recipient::text) THEN RAISE EXCEPTION 'Recipient unavailable';END IF;
 DELETE FROM sign_credentials WHERE envelope_id=p_id AND recipient_id=p_recipient AND organization_id=e.organization_id;
 INSERT INTO sign_access_audit(organization_id,envelope_id,recipient_id,actor_id,operation) VALUES(e.organization_id,p_id,p_recipient,auth_member_id(e.organization_id),'recipient_access_revoked');
END $$;
REVOKE ALL ON FUNCTION public.sign_revoke_recipient(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sign_revoke_recipient(uuid,uuid) TO authenticated;
