-- Validate the type of empty values before checking requiredness. An empty
-- array is a meaningful empty selection only for a multiselect field.
DO $$ DECLARE definition text; old_condition text := $condition$IF v IS NULL OR v='null'::jsonb OR v='""'::jsonb OR v='[]'::jsonb THEN$condition$; BEGIN
 SELECT pg_get_functiondef('crm_validate_custom_values()'::regprocedure) INTO definition;
 IF position(old_condition in definition)>0 THEN
  EXECUTE replace(definition,old_condition,$condition$IF v IS NULL OR v='null'::jsonb OR (f.type='multiselect' AND v='[]'::jsonb) OR (f.type IN ('text','multiline','email','phone','url','dropdown','date','datetime','member','contact','company') AND jsonb_typeof(v)='string' AND s ~ '^[[:space:]]*$') THEN$condition$);
 END IF;
END $$;
