CREATE TABLE IF NOT EXISTS sign_template_versions (
 template_id uuid NOT NULL REFERENCES sign_templates(id),organization_id uuid NOT NULL REFERENCES organizations(id),
 revision integer NOT NULL,name text NOT NULL,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(template_id,revision)
);
ALTER TABLE sign_template_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sign_template_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON sign_template_versions TO authenticated;
DROP POLICY IF EXISTS sign_template_version_read ON sign_template_versions;
CREATE POLICY sign_template_version_read ON sign_template_versions FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm'));
CREATE OR REPLACE FUNCTION public.sign_template_version_capture() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.data IS DISTINCT FROM OLD.data AND NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Template update requires a new revision';END IF;
 INSERT INTO sign_template_versions(template_id,organization_id,revision,name,data) VALUES(NEW.id,NEW.organization_id,NEW.revision,NEW.name,NEW.data) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sign_template_version_capture ON sign_templates;
CREATE TRIGGER sign_template_version_capture AFTER INSERT OR UPDATE ON sign_templates FOR EACH ROW EXECUTE FUNCTION public.sign_template_version_capture();
INSERT INTO sign_template_versions(template_id,organization_id,revision,name,data) SELECT id,organization_id,revision,name,data FROM sign_templates ON CONFLICT DO NOTHING;
