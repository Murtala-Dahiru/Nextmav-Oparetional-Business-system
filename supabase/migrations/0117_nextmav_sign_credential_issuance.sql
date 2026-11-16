CREATE OR REPLACE FUNCTION public.sign_issue_credential(p_hash text,p_envelope uuid,p_revision integer,p_recipient uuid,p_kind text,p_generation integer,p_expires timestamptz,p_verified boolean,p_otp text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e sign_envelopes%ROWTYPE;
BEGIN
 SELECT * INTO e FROM sign_envelopes WHERE id=p_envelope FOR SHARE;
 IF NOT FOUND OR e.revision<>p_revision OR e.archived_at IS NOT NULL OR e.status NOT IN ('sent','in_progress','finalizing','completed') OR (e.data->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'Access changed; reopen the invitation';END IF;
 IF p_expires> (e.data->>'expiresAt')::timestamptz OR p_expires<=now() OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.data->'recipients') r WHERE r->>'id'=p_recipient::text AND (r->>'generation')::integer=p_generation) THEN RAISE EXCEPTION 'Invalid credential scope';END IF;
 INSERT INTO sign_credentials(hash,organization_id,envelope_id,recipient_id,kind,generation,expires_at,verified,otp_hash) VALUES(p_hash,e.organization_id,e.id,p_recipient,p_kind,p_generation,p_expires,p_verified,p_otp);
END $$;
REVOKE ALL ON FUNCTION public.sign_issue_credential(text,uuid,integer,uuid,text,integer,timestamptz,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sign_issue_credential(text,uuid,integer,uuid,text,integer,timestamptz,boolean,text) TO service_role;
