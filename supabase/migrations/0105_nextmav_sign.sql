-- NextMav Sign: private, module-independent agreement aggregate. All mutations
-- are service-only compare-and-swap transactions; internal reads retain CRM scope.
CREATE TABLE IF NOT EXISTS sign_envelopes (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 owner_id uuid NOT NULL REFERENCES organization_members(id),
 record_id uuid REFERENCES crm_commercial_records(id), version_id uuid REFERENCES crm_commercial_versions(id),
 title text NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','in_progress','finalizing','completed','declined','revoked','expired','changes_requested')),
 revision integer NOT NULL DEFAULT 0, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id)
);
CREATE INDEX sign_directory ON sign_envelopes(organization_id,status,updated_at DESC,id);
CREATE INDEX sign_related ON sign_envelopes(record_id);
ALTER TABLE sign_envelopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sign_envelopes FROM anon,authenticated;
GRANT SELECT ON sign_envelopes TO authenticated;
CREATE POLICY sign_read ON sign_envelopes FOR SELECT TO authenticated USING (
 crm_record_visible(organization_id,owner_id) AND (record_id IS NULL OR crm_commercial_visible(organization_id,record_id))
);
CREATE TABLE IF NOT EXISTS sign_credentials (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 hash text PRIMARY KEY CHECK(length(hash)=64), envelope_id uuid NOT NULL REFERENCES sign_envelopes(id),
 recipient_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('link','session','challenge')),
 generation integer NOT NULL, expires_at timestamptz NOT NULL, verified boolean NOT NULL DEFAULT false,
 otp_hash text, attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sign_credential_envelope ON sign_credentials(envelope_id,recipient_id);
ALTER TABLE sign_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sign_credentials FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS sign_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
ALTER TABLE sign_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sign_limits FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sign_limit(p_key text,p_max integer,p_seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 INSERT INTO sign_limits VALUES(p_key,1,now()+make_interval(secs=>p_seconds)) ON CONFLICT(key) DO UPDATE
 SET count=CASE WHEN sign_limits.expires_at<now() THEN 1 ELSE sign_limits.count+1 END,
 expires_at=CASE WHEN sign_limits.expires_at<now() THEN excluded.expires_at ELSE sign_limits.expires_at END RETURNING count INTO n;
 RETURN n<=p_max;
END $$;
REVOKE ALL ON FUNCTION public.sign_limit(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sign_limit(text,integer,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.sign_commit(p_id uuid,p_revision integer,p_status text,p_data jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e sign_envelopes%ROWTYPE;
BEGIN
 SELECT * INTO e FROM sign_envelopes WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR e.revision<>p_revision THEN RETURN false; END IF;
 IF e.status IN ('completed','declined','revoked','expired','changes_requested') THEN RAISE EXCEPTION 'Agreement is closed'; END IF;
 IF e.status<>'draft' AND (p_data->'source' IS DISTINCT FROM e.data->'source' OR p_data->'fields' IS DISTINCT FROM e.data->'fields' OR p_data->'consent' IS DISTINCT FROM e.data->'consent') THEN RAISE EXCEPTION 'Issued document configuration is immutable';END IF;
 UPDATE sign_envelopes SET status=p_status,data=p_data,title=p_data->>'title',revision=revision+1,updated_at=now() WHERE id=p_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.sign_commit(uuid,integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sign_commit(uuid,integer,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.sign_consume_otp(p_hash text,p_otp text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c sign_credentials%ROWTYPE;
BEGIN
 SELECT * INTO c FROM sign_credentials WHERE hash=p_hash AND kind='challenge' FOR UPDATE;
 IF NOT FOUND OR c.expires_at<=now() OR c.attempts>=5 OR c.verified THEN RETURN false; END IF;
 UPDATE sign_credentials SET attempts=attempts+1,verified=(otp_hash=p_otp),otp_hash=CASE WHEN otp_hash=p_otp THEN NULL ELSE otp_hash END WHERE hash=p_hash;
 RETURN c.otp_hash=p_otp;
END $$;
REVOKE ALL ON FUNCTION public.sign_consume_otp(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sign_consume_otp(text,text) TO service_role;
CREATE TABLE IF NOT EXISTS sign_settings (organization_id uuid PRIMARY KEY REFERENCES organizations(id),data jsonb NOT NULL DEFAULT '{"allowPossession":false,"defaultDays":14,"verification":"email_otp"}');
CREATE TABLE IF NOT EXISTS sign_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),name text NOT NULL,revision integer NOT NULL DEFAULT 1,data jsonb NOT NULL,archived boolean NOT NULL DEFAULT false);
ALTER TABLE sign_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sign_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sign_settings,sign_templates FROM anon,authenticated;
GRANT SELECT ON sign_settings,sign_templates TO authenticated;
CREATE POLICY sign_settings_read ON sign_settings FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm'));
CREATE POLICY sign_templates_read ON sign_templates FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm'));
-- No public or authenticated storage policies: all byte access goes through a
-- scoped application endpoint. No upsert, update or delete path for signed files.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('nextmav-sign','nextmav-sign',false,20971520,ARRAY['application/pdf','application/json']) ON CONFLICT(id) DO NOTHING;
