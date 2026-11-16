-- A portal member can read their company row. Keep internal CRM values in a
-- separately protected relation. A nullable input column permits atomic writes
-- through the existing company insert/update APIs, but never stores a value.
CREATE TABLE IF NOT EXISTS crm_company_field_values (
 company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 organization_id uuid NOT NULL REFERENCES organizations(id), field_values jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_company_fields_search ON crm_company_field_values USING gin(field_values jsonb_path_ops);
CREATE INDEX IF NOT EXISTS crm_company_fields_org ON crm_company_field_values(organization_id,company_id);
ALTER TABLE crm_company_field_values ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_company_field_values FROM PUBLIC,anon,authenticated;
GRANT SELECT ON crm_company_field_values TO authenticated;
DROP POLICY IF EXISTS crm_company_fields_read ON crm_company_field_values;
CREATE POLICY crm_company_fields_read ON crm_company_field_values FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm') AND EXISTS(SELECT 1 FROM companies c WHERE c.id=company_id AND c.organization_id=crm_company_field_values.organization_id AND c.deleted_at IS NULL));

DROP TRIGGER IF EXISTS crm_custom_value_guard ON companies;
DROP TRIGGER IF EXISTS a_crm_company_values_input ON companies;
DROP TRIGGER IF EXISTS z_crm_company_values_store ON companies;
ALTER TABLE companies ALTER COLUMN custom_values DROP NOT NULL, ALTER COLUMN custom_values DROP DEFAULT;
INSERT INTO crm_company_field_values(company_id,organization_id,field_values)
 SELECT id,organization_id,custom_values FROM companies WHERE custom_values IS NOT NULL AND custom_values<>'{}'
 ON CONFLICT(company_id) DO UPDATE SET field_values=excluded.field_values;
UPDATE companies SET custom_values=NULL WHERE custom_values IS NOT NULL AND custom_values<>'{}';

CREATE OR REPLACE FUNCTION public.crm_company_values_input() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'Cannot change company tenant' USING ERRCODE='42501'; END IF;
 IF NEW.custom_values IS NULL THEN
  SELECT field_values INTO prior FROM crm_company_field_values WHERE company_id=NEW.id AND organization_id=NEW.organization_id;
  NEW.custom_values:=coalesce(prior,'{}'::jsonb);
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.crm_company_values_store() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.custom_values<>'{}' THEN
  INSERT INTO crm_company_field_values(company_id,organization_id,field_values) VALUES(NEW.id,NEW.organization_id,NEW.custom_values)
   ON CONFLICT(company_id) DO UPDATE SET field_values=excluded.field_values WHERE crm_company_field_values.organization_id=excluded.organization_id AND crm_company_field_values.field_values IS DISTINCT FROM excluded.field_values;
 ELSE
  DELETE FROM crm_company_field_values WHERE company_id=NEW.id AND organization_id=NEW.organization_id;
 END IF;
 NEW.custom_values:=NULL;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_company_values_input(),crm_company_values_store() FROM PUBLIC;
CREATE TRIGGER a_crm_company_values_input BEFORE INSERT OR UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION crm_company_values_input();
CREATE TRIGGER crm_custom_value_guard BEFORE INSERT OR UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION crm_validate_custom_values();
CREATE TRIGGER z_crm_company_values_store BEFORE INSERT OR UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION crm_company_values_store();

CREATE OR REPLACE FUNCTION public.crm_company_values(c companies) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT field_values FROM crm_company_field_values WHERE company_id=c.id AND organization_id=c.organization_id),'{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION crm_company_values(companies) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_company_values(companies) TO authenticated;
