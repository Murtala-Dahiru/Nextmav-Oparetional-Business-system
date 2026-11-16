ALTER TABLE sign_credentials ADD COLUMN IF NOT EXISTS organization_id uuid;
UPDATE sign_credentials c SET organization_id=e.organization_id FROM sign_envelopes e WHERE c.envelope_id=e.id AND c.organization_id IS NULL;
ALTER TABLE sign_credentials ALTER COLUMN organization_id SET NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sign_credentials_tenant_envelope') THEN
 ALTER TABLE sign_credentials ADD CONSTRAINT sign_credentials_tenant_envelope FOREIGN KEY(organization_id,envelope_id) REFERENCES sign_envelopes(organization_id,id);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sign_credential_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE tenant uuid;
BEGIN
 SELECT organization_id INTO tenant FROM sign_envelopes WHERE id=NEW.envelope_id;
 IF tenant IS NULL OR (NEW.organization_id IS NOT NULL AND NEW.organization_id<>tenant) THEN RAISE EXCEPTION 'Invalid credential scope';END IF;
 NEW.organization_id:=tenant;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sign_credential_scope ON sign_credentials;
CREATE TRIGGER sign_credential_scope BEFORE INSERT OR UPDATE OF envelope_id,organization_id ON sign_credentials FOR EACH ROW EXECUTE FUNCTION public.sign_credential_scope();
