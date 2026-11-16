CREATE TABLE IF NOT EXISTS crm_commercial_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), sections jsonb NOT NULL CHECK(jsonb_typeof(sections)='array' AND jsonb_array_length(sections)<=40),
 revision integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES organization_members(id), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,name)
);
ALTER TABLE crm_commercial_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_commercial_templates FROM anon,authenticated;
GRANT SELECT ON crm_commercial_templates TO authenticated;
DROP POLICY IF EXISTS commercial_template_read ON crm_commercial_templates;
CREATE POLICY commercial_template_read ON crm_commercial_templates FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm'));
CREATE OR REPLACE FUNCTION public.crm_commercial_template_save(p_org uuid,p_id uuid,p_revision integer,p_name text,p_sections jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rid uuid:=coalesce(p_id,gen_random_uuid()); current_revision integer;
BEGIN
 IF NOT crm_automation_admin(p_org) THEN RAISE EXCEPTION 'Administrator required to manage shared templates' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_sections) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sections)>40 OR octet_length(p_sections::text)>200000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_sections) s WHERE length(coalesce(s->>'title','')) NOT BETWEEN 1 AND 200 OR length(coalesce(s->>'body',''))>20000) THEN RAISE EXCEPTION 'Invalid proposal sections' USING ERRCODE='22023';END IF;
 IF p_id IS NULL THEN INSERT INTO crm_commercial_templates(id,organization_id,name,sections,created_by) VALUES(rid,p_org,p_name,p_sections,auth_member_id(p_org));
 ELSE
  SELECT revision INTO current_revision FROM crm_commercial_templates WHERE id=p_id AND organization_id=p_org FOR UPDATE;
  IF current_revision IS NULL OR current_revision<>p_revision THEN RAISE EXCEPTION 'Stale template' USING ERRCODE='PT409';END IF;
  UPDATE crm_commercial_templates SET name=p_name,sections=p_sections,revision=revision+1,updated_at=now() WHERE id=p_id;
 END IF;RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.crm_commercial_template_save(uuid,uuid,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_commercial_template_save(uuid,uuid,integer,text,jsonb) TO authenticated;

-- A metadata row alone must not serve as execution evidence.
DROP POLICY IF EXISTS commercial_file_object_required ON crm_commercial_files;
CREATE POLICY commercial_file_object_required ON crm_commercial_files AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='crm-files' AND o.name=storage_path AND (o.metadata->>'size')::bigint=size_bytes));
-- Keep exact total strings at the API boundary; numeric columns remain authoritative in SQL.
CREATE OR REPLACE FUNCTION public.crm_commercial_catalog_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.content->'items') LOOP
  IF nullif(item->>'productId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM products WHERE id=(item->>'productId')::uuid AND organization_id=NEW.organization_id AND deleted_at IS NULL AND is_active) THEN RAISE EXCEPTION 'Catalog product is not available in this organization' USING ERRCODE='42501';END IF;
 END LOOP;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_commercial_catalog_check() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS commercial_catalog_check ON crm_commercial_records;
CREATE TRIGGER commercial_catalog_check BEFORE INSERT OR UPDATE OF content ON crm_commercial_records FOR EACH ROW EXECUTE FUNCTION public.crm_commercial_catalog_check();
