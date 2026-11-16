ALTER TABLE crm_field_definitions ADD COLUMN IF NOT EXISTS validation jsonb NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION public.crm_field_rules_valid(f crm_field_definitions,v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
BEGIN
 IF v IS NULL OR v='null'::jsonb THEN RETURN true; END IF;
 IF jsonb_typeof(v)='number' THEN
  RETURN (NOT(f.validation ? 'min') OR (v#>>'{}')::numeric >= (f.validation->>'min')::numeric)
   AND (NOT(f.validation ? 'max') OR (v#>>'{}')::numeric <= (f.validation->>'max')::numeric);
 END IF;
 IF jsonb_typeof(v)='string' AND f.validation ? 'maxLength' THEN RETURN length(v#>>'{}') <= (f.validation->>'maxLength')::integer; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION crm_field_rules_valid(crm_field_definitions,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.crm_field_rules_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k text;
BEGIN
 IF jsonb_typeof(NEW.validation) IS DISTINCT FROM 'object' OR octet_length(NEW.validation::text)>1000 THEN RAISE EXCEPTION 'Invalid validation rules' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT jsonb_object_keys(NEW.validation) LOOP
  IF k NOT IN ('min','max','maxLength') OR jsonb_typeof(NEW.validation->k)<>'number' THEN RAISE EXCEPTION 'Unsupported validation rule' USING ERRCODE='22023'; END IF;
  IF k IN ('min','max') AND (NEW.type NOT IN ('number','currency','percentage') OR abs((NEW.validation->>k)::numeric)>1e15) THEN RAISE EXCEPTION 'Numeric rule is invalid for this field' USING ERRCODE='22023'; END IF;
  IF k='maxLength' AND (NEW.type NOT IN ('text','multiline','email','phone','url') OR (NEW.validation->>k)::numeric NOT BETWEEN 1 AND 12000 OR trunc((NEW.validation->>k)::numeric)<>(NEW.validation->>k)::numeric) THEN RAISE EXCEPTION 'Invalid text length' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF (NEW.validation->>'min')::numeric>(NEW.validation->>'max')::numeric OR NOT crm_field_rules_valid(NEW,NEW.default_value) THEN RAISE EXCEPTION 'Default or validation range is invalid' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_field_rules_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_field_rules_guard ON crm_field_definitions;
CREATE TRIGGER crm_field_rules_guard BEFORE INSERT OR UPDATE ON crm_field_definitions FOR EACH ROW EXECUTE FUNCTION crm_field_rules_guard();
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('crm_field_save(uuid,jsonb)'::regprocedure) INTO definition;
 IF position('validation=excluded' in definition)=0 THEN
  definition:=replace(definition,'options,position,version,default_value)','options,position,version,default_value,validation)');
  definition:=replace(definition,'ELSE oldrow.default_value END)', 'ELSE oldrow.default_value END,coalesce(p_value->''validation'',oldrow.validation,''{}''::jsonb))');
  EXECUTE replace(definition,'SET default_value=excluded.default_value','SET validation=excluded.validation,default_value=excluded.default_value');
 END IF;
 SELECT pg_get_functiondef('crm_validate_custom_values()'::regprocedure) INTO definition;
 IF position('crm_field_rules_valid' in definition)=0 THEN
  EXECUTE replace(definition,'IF f.type IN (''member''','IF (TG_OP=''INSERT'' OR v IS DISTINCT FROM prior->f.id::text) AND NOT crm_field_rules_valid(f,v) THEN RAISE EXCEPTION ''Validation rule failed: %'',f.label USING ERRCODE=''22023''; END IF; IF f.type IN (''member''');
 END IF;
END $$;
