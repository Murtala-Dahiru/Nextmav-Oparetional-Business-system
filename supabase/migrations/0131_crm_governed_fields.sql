-- Metadata governs UUID-keyed record values. Atomic record writes, bounded values,
-- GIN containment indexes, immutable types and options, and database validation.
CREATE TABLE IF NOT EXISTS crm_field_definitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 object text NOT NULL CHECK(object IN ('leads','contacts','companies','deals')),
 key text NOT NULL CHECK(key ~ '^[a-z][a-z0-9_]{0,59}$'),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 100),
 type text NOT NULL CHECK(type IN ('text','multiline','number','currency','percentage','date','datetime','dropdown','multiselect','checkbox','email','phone','url')),
 required boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false,
 options jsonb NOT NULL DEFAULT '[]', position integer NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 100),
 version integer NOT NULL DEFAULT 1, UNIQUE(organization_id,object,key)
);
CREATE TABLE IF NOT EXISTS crm_configuration_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 actor_id uuid REFERENCES organization_members(id), change_type text NOT NULL, target_id uuid NOT NULL,
 before_metadata jsonb, after_metadata jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_configuration_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_field_definitions,crm_configuration_audit FROM anon,authenticated;
GRANT SELECT ON crm_field_definitions,crm_configuration_audit TO authenticated;
DROP POLICY IF EXISTS crm_field_read ON crm_field_definitions;
CREATE POLICY crm_field_read ON crm_field_definitions FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm'));
DROP POLICY IF EXISTS crm_configuration_audit_read ON crm_configuration_audit;
CREATE POLICY crm_configuration_audit_read ON crm_configuration_audit FOR SELECT TO authenticated USING(crm_automation_admin(organization_id));
CREATE INDEX IF NOT EXISTS crm_configuration_audit_recent ON crm_configuration_audit(organization_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.crm_field_save(p_org uuid,p_value jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE oldrow crm_field_definitions%ROWTYPE; newrow crm_field_definitions%ROWTYPE; rid uuid:=coalesce((p_value->>'id')::uuid,gen_random_uuid()); n integer;
BEGIN
 IF NOT coalesce(crm_automation_admin(p_org),false) THEN RAISE EXCEPTION 'CRM administrator required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text,131));
 IF octet_length(p_value::text)>32000 OR jsonb_typeof(p_value->'options') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid definition' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_value->'options')>100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'options') v WHERE jsonb_typeof(v)<>'string' OR length(btrim(v#>>'{}')) NOT BETWEEN 1 AND 100) OR (SELECT count(*)<>count(DISTINCT v) FROM jsonb_array_elements(p_value->'options') v) THEN RAISE EXCEPTION 'Invalid options' USING ERRCODE='22023'; END IF;
 IF p_value->>'type' IN ('dropdown','multiselect') AND jsonb_array_length(p_value->'options')=0 THEN RAISE EXCEPTION 'Options required' USING ERRCODE='22023'; END IF;
 SELECT * INTO oldrow FROM crm_field_definitions WHERE id=rid AND organization_id=p_org FOR UPDATE;
 IF p_value->>'id' IS NOT NULL AND oldrow.id IS NULL THEN RAISE EXCEPTION 'Field unavailable' USING ERRCODE='42501'; END IF;
 IF coalesce(oldrow.version,0) IS DISTINCT FROM (p_value->>'version')::integer THEN RAISE EXCEPTION 'Field changed; reload' USING ERRCODE='PT409'; END IF;
 IF oldrow.id IS NOT NULL AND (oldrow.object IS DISTINCT FROM p_value->>'object' OR oldrow.key IS DISTINCT FROM p_value->>'key' OR oldrow.type IS DISTINCT FROM p_value->>'type' OR NOT (p_value->'options' @> oldrow.options)) THEN RAISE EXCEPTION 'Object, key and type are immutable; existing options cannot be removed' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO n FROM crm_field_definitions WHERE organization_id=p_org AND object=p_value->>'object';
 IF oldrow.id IS NULL AND n>=100 THEN RAISE EXCEPTION 'Limit of 100 fields per object reached' USING ERRCODE='22023'; END IF;
 INSERT INTO crm_field_definitions(id,organization_id,object,key,label,type,required,archived,options,position,version)
 VALUES(rid,p_org,p_value->>'object',p_value->>'key',p_value->>'label',p_value->>'type',(p_value->>'required')::boolean,(p_value->>'archived')::boolean,p_value->'options',(p_value->>'position')::integer,1)
 ON CONFLICT(id) DO UPDATE SET label=excluded.label,required=excluded.required,archived=excluded.archived,options=excluded.options,position=excluded.position,version=crm_field_definitions.version+1 RETURNING * INTO newrow;
 INSERT INTO crm_configuration_audit(organization_id,actor_id,change_type,target_id,before_metadata,after_metadata)
 VALUES(p_org,auth_member_id(p_org),'field.saved',rid,CASE WHEN oldrow.id IS NULL THEN NULL ELSE to_jsonb(oldrow) END,to_jsonb(newrow));
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION crm_field_save(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_field_save(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_validate_custom_values() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f crm_field_definitions%ROWTYPE; v jsonb; s text; k text; prior jsonb:='{}';
BEGIN
 IF TG_OP='UPDATE' THEN
  prior:=coalesce(OLD.custom_values,'{}'::jsonb);
  IF TG_TABLE_NAME='companies' AND to_regclass('public.crm_company_field_values') IS NOT NULL THEN
   SELECT coalesce((SELECT field_values FROM crm_company_field_values WHERE company_id=OLD.id AND organization_id=OLD.organization_id),'{}'::jsonb) INTO prior;
  END IF;
 END IF;
 IF jsonb_typeof(NEW.custom_values) IS DISTINCT FROM 'object' OR octet_length(NEW.custom_values::text)>128000 THEN RAISE EXCEPTION 'Invalid custom values' USING ERRCODE='22023'; END IF;
 -- Serialize metadata changes with value writes so archive and schema checks cannot race.
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(NEW.organization_id::text,131));
 FOR k IN SELECT jsonb_object_keys(NEW.custom_values) LOOP
  IF NOT EXISTS(SELECT 1 FROM crm_field_definitions WHERE organization_id=NEW.organization_id AND object=TG_TABLE_NAME AND id::text=k) THEN RAISE EXCEPTION 'Unknown custom field' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR f IN SELECT * FROM crm_field_definitions WHERE organization_id=NEW.organization_id AND object=TG_TABLE_NAME LOOP
  v:=NEW.custom_values->f.id::text; s:=v#>>'{}';
  IF f.archived THEN
   IF v IS DISTINCT FROM prior->f.id::text THEN RAISE EXCEPTION 'Archived field values are read-only: %',f.label USING ERRCODE='22023'; END IF;
   CONTINUE;
  END IF;
  IF v IS NULL OR v='null'::jsonb OR v='""'::jsonb OR v='[]'::jsonb THEN
   -- Existing records are grandfathered on unrelated updates; new or changed values enforce requiredness.
   IF f.required AND (TG_OP='INSERT' OR NEW.custom_values IS DISTINCT FROM prior) THEN RAISE EXCEPTION 'Required custom field: %',f.label USING ERRCODE='22023'; END IF;
   CONTINUE;
  END IF;
  IF f.type IN ('number','currency','percentage') THEN
   IF jsonb_typeof(v)<>'number' OR abs(s::numeric)>1e15 OR (f.type='percentage' AND s::numeric NOT BETWEEN 0 AND 100) THEN RAISE EXCEPTION 'Invalid number: %',f.label USING ERRCODE='22023'; END IF;
  ELSIF f.type='checkbox' THEN
   IF jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'Invalid checkbox: %',f.label USING ERRCODE='22023'; END IF;
  ELSIF f.type='multiselect' THEN
   IF jsonb_typeof(v)<>'array' THEN RAISE EXCEPTION 'Invalid selection: %',f.label USING ERRCODE='22023'; END IF;
   IF jsonb_array_length(v)>100 OR NOT(f.options @> v) OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements(v) x) THEN RAISE EXCEPTION 'Invalid selection: %',f.label USING ERRCODE='22023'; END IF;
  ELSE
   IF jsonb_typeof(v)<>'string' OR length(s)>(CASE WHEN f.type='multiline' THEN 12000 ELSE 1000 END) THEN RAISE EXCEPTION 'Invalid text: %',f.label USING ERRCODE='22023'; END IF;
   IF f.type='dropdown' AND NOT(f.options @> jsonb_build_array(s)) THEN RAISE EXCEPTION 'Invalid option: %',f.label USING ERRCODE='22023'; END IF;
   IF f.type='email' AND s !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid email: %',f.label USING ERRCODE='22023'; END IF;
   IF f.type='url' AND s !~ '^https?://[^[:space:]/]+[^[:space:]]*$' THEN RAISE EXCEPTION 'Invalid URL: %',f.label USING ERRCODE='22023'; END IF;
   IF f.type='phone' AND s !~ '^\+?[0-9 ()#.*-]{3,80}$' THEN RAISE EXCEPTION 'Invalid phone: %',f.label USING ERRCODE='22023'; END IF;
   IF f.type='date' THEN
    IF s !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid date: %',f.label USING ERRCODE='22023'; END IF;
    PERFORM s::date;
   END IF;
   IF f.type='datetime' THEN
    IF s !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'Date and time needs a timezone: %',f.label USING ERRCODE='22023'; END IF;
    PERFORM s::timestamptz;
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_validate_custom_values() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['leads','contacts','companies','deals'] LOOP
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS custom_values jsonb NOT NULL DEFAULT ''{}''',t);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin(custom_values jsonb_path_ops)',t||'_custom_values_gin',t);
  EXECUTE format('DROP TRIGGER IF EXISTS crm_custom_value_guard ON public.%I',t);
  EXECUTE format('CREATE TRIGGER crm_custom_value_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION crm_validate_custom_values()',t);
 END LOOP;
END $$;
