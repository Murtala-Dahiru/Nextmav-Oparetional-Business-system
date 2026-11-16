ALTER TABLE crm_field_definitions DROP CONSTRAINT IF EXISTS crm_field_definitions_type_check;
ALTER TABLE crm_field_definitions ADD CONSTRAINT crm_field_definitions_type_check CHECK(type IN ('text','multiline','number','currency','percentage','date','datetime','dropdown','multiselect','checkbox','email','phone','url','member','company','contact'));
CREATE OR REPLACE FUNCTION public.crm_valid_field_reference(p_org uuid,p_kind text,p_value jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rid uuid;
BEGIN
 IF jsonb_typeof(p_value)<>'string' THEN RETURN false; END IF;
 rid:=(p_value#>>'{}')::uuid;
 CASE p_kind
 WHEN 'member' THEN RETURN EXISTS(SELECT 1 FROM organization_members WHERE organization_id=p_org AND id=rid AND is_active AND deleted_at IS NULL AND role NOT IN ('client','partner'));
 WHEN 'company' THEN RETURN EXISTS(SELECT 1 FROM companies WHERE organization_id=p_org AND id=rid AND deleted_at IS NULL);
 WHEN 'contact' THEN RETURN EXISTS(SELECT 1 FROM contacts WHERE organization_id=p_org AND id=rid AND deleted_at IS NULL);
 ELSE RETURN false; END CASE;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION crm_valid_field_reference(uuid,text,jsonb) FROM PUBLIC;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('crm_validate_custom_values()'::regprocedure) INTO definition;
 IF position('crm_valid_field_reference' in definition)=0 THEN
  IF position('IF f.type IN (''number''' in definition)=0 THEN RAISE EXCEPTION 'Unexpected custom value validator'; END IF;
  EXECUTE replace(definition,'IF f.type IN (''number''','IF f.type IN (''member'',''company'',''contact'') THEN
   IF v IS DISTINCT FROM prior->f.id::text AND NOT crm_valid_field_reference(NEW.organization_id,f.type,v) THEN RAISE EXCEPTION ''Unavailable reference: %'',f.label USING ERRCODE=''22023''; END IF;
  ELSIF f.type IN (''number''');
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.crm_field_default_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT crm_check_field_default(NEW,NEW.default_value) OR (NEW.type IN ('member','company','contact') AND NEW.default_value IS NOT NULL AND NOT crm_valid_field_reference(NEW.organization_id,NEW.type,NEW.default_value)) THEN RAISE EXCEPTION 'Invalid default for %',NEW.label USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_field_default_guard() FROM PUBLIC;
