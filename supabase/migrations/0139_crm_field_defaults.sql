ALTER TABLE crm_field_definitions ADD COLUMN IF NOT EXISTS default_value jsonb;
CREATE OR REPLACE FUNCTION public.crm_check_field_default(f crm_field_definitions,v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE s text:=v#>>'{}';
BEGIN
 IF v IS NULL OR v='null'::jsonb THEN RETURN true; END IF;
 CASE
 WHEN f.type IN ('number','currency','percentage') THEN RETURN jsonb_typeof(v)='number' AND abs(s::numeric)<=1e15 AND (f.type<>'percentage' OR s::numeric BETWEEN 0 AND 100);
 WHEN f.type='checkbox' THEN RETURN jsonb_typeof(v)='boolean';
 WHEN f.type='multiselect' THEN RETURN jsonb_typeof(v)='array' AND jsonb_array_length(v) BETWEEN 1 AND 100 AND f.options @> v AND (SELECT count(*)=count(DISTINCT x) FROM jsonb_array_elements(v) x);
 ELSE
  IF jsonb_typeof(v)<>'string' OR length(btrim(s)) NOT BETWEEN 1 AND (CASE WHEN f.type='multiline' THEN 12000 ELSE 1000 END) THEN RETURN false; END IF;
  CASE f.type
  WHEN 'dropdown' THEN RETURN f.options @> jsonb_build_array(s);
  WHEN 'date' THEN RETURN s ~ '^\d{4}-\d{2}-\d{2}$' AND s::date IS NOT NULL;
  WHEN 'datetime' THEN RETURN s ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' AND s::timestamptz IS NOT NULL;
  WHEN 'email' THEN RETURN s ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
  WHEN 'phone' THEN RETURN s ~ '^\+?[0-9 ()#.*-]{3,80}$';
  WHEN 'url' THEN RETURN s ~ '^https?://[^[:space:]/]+[^[:space:]]*$';
  ELSE RETURN true; END CASE;
 END CASE;
EXCEPTION WHEN data_exception THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION crm_check_field_default(crm_field_definitions,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.crm_field_default_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT crm_check_field_default(NEW,NEW.default_value) THEN RAISE EXCEPTION 'Invalid default for %',NEW.label USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_field_default_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_field_default_guard ON crm_field_definitions;
CREATE TRIGGER crm_field_default_guard BEFORE INSERT OR UPDATE ON crm_field_definitions FOR EACH ROW EXECUTE FUNCTION crm_field_default_guard();
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('crm_field_save(uuid,jsonb)'::regprocedure) INTO definition;
 IF position('default_value' in definition)=0 THEN
  IF position('options,position,version)' in definition)=0 THEN RAISE EXCEPTION 'Unexpected field definition writer'; END IF;
  definition:=replace(definition,'options,position,version)','options,position,version,default_value)');
  definition:=replace(definition,'::integer,1)', '::integer,1,CASE WHEN p_value ? ''defaultValue'' THEN nullif(p_value->''defaultValue'',''null''::jsonb) ELSE oldrow.default_value END)');
  EXECUTE replace(definition,'SET label=excluded.label','SET default_value=excluded.default_value,label=excluded.label');
 END IF;
 SELECT pg_get_functiondef('crm_validate_custom_values()'::regprocedure) INTO definition;
 IF position('f.default_value' in definition)=0 THEN
  EXECUTE replace(definition,'v:=NEW.custom_values->f.id::text;', 'IF TG_OP=''INSERT'' AND NOT f.archived AND f.default_value IS NOT NULL AND NOT (NEW.custom_values ? f.id::text) THEN NEW.custom_values:=jsonb_set(NEW.custom_values,ARRAY[f.id::text],f.default_value); END IF; v:=NEW.custom_values->f.id::text;');
 END IF;
END $$;
