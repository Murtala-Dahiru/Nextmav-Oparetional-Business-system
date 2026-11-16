-- Retain only the custom values needed by currently published conditions.
-- The existing event sanitization and admin-only event policies stay in force.
DO $$ DECLARE definition text; needle text:='INSERT INTO crm_automation_events(organization_id,trigger,entity,record_id,snapshot,causation_id,depth)'; BEGIN
 SELECT pg_get_functiondef('crm_automation_emit(uuid,text,text,uuid,jsonb)'::regprocedure) INTO definition;
 IF position('referenced_custom_fields' in definition)=0 THEN
  IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Unsupported automation event writer'; END IF;
  EXECUTE replace(definition,needle,$addition$
  IF p_entity IN ('lead','deal','contact') AND p_snapshot->'custom_values' <> '{}'::jsonb THEN
   WITH referenced_custom_fields AS (
    SELECT DISTINCT f.id::text AS key FROM crm_automations a
    JOIN crm_automation_versions v ON v.id=a.published_version AND v.organization_id=a.organization_id
    CROSS JOIN LATERAL jsonb_array_elements(v.definition->'conditions'->'groups') g
    CROSS JOIN LATERAL jsonb_array_elements(g->'rules') rule
    JOIN crm_field_definitions f ON f.organization_id=p_org AND f.object=p_entity||'s'
      AND 'custom:'||f.id::text=rule->>'field' AND NOT f.archived
      AND f.type IN ('text','dropdown','checkbox','email','phone','url')
    WHERE a.organization_id=p_org AND a.status='published' AND v.definition->>'trigger'=p_trigger
   ) SELECT safe || jsonb_build_object('custom_values',coalesce(jsonb_object_agg(key,p_snapshot->'custom_values'->key),'{}'::jsonb))
     INTO safe FROM referenced_custom_fields WHERE (p_snapshot->'custom_values') ? key;
  END IF;
  $addition$||needle);
 END IF;
END $$;
