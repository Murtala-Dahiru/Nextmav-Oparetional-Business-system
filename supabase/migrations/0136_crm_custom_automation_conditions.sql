-- Stable IDs in the existing condition language. Limit support to equality and
-- presence checks on scalar snapshots captured by existing record triggers.
CREATE OR REPLACE FUNCTION public.crm_automation_field_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; obj text;
BEGIN
 obj:=CASE split_part(NEW.draft->>'trigger','.',1) WHEN 'lead' THEN 'leads' WHEN 'deal' THEN 'deals' WHEN 'contact' THEN 'contacts' END;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(NEW.organization_id::text,131));
 FOR r IN SELECT rule FROM jsonb_array_elements(NEW.draft->'conditions'->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'rules') rule WHERE left(rule->>'field',7)='custom:' LOOP
  IF NEW.draft->>'trigger' NOT IN ('lead.created','contact.created','deal.created','deal.stage_changed','lead.status_changed','lead.assigned','deal.owner_changed') OR r->>'operator' NOT IN ('equals','not_equals','empty','not_empty') OR NOT EXISTS(SELECT 1 FROM crm_field_definitions WHERE organization_id=NEW.organization_id AND object=obj AND NOT archived AND type IN ('text','dropdown','checkbox','email','phone','url') AND id::text=substr(r->>'field',8)) THEN RAISE EXCEPTION 'Unsupported custom field or automation condition' USING ERRCODE='22023'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_automation_field_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_automation_field_guard ON crm_automations;
CREATE TRIGGER crm_automation_field_guard BEFORE INSERT OR UPDATE ON crm_automations FOR EACH ROW EXECUTE FUNCTION crm_automation_field_guard();
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('crm_automation_validate(jsonb)'::regprocedure) INTO definition;
 IF position('left(f,7)' in definition)=0 THEN
  IF position('OR NOT (CASE entity' in definition)=0 THEN RAISE EXCEPTION 'Unexpected automation validator version'; END IF;
  EXECUTE replace(definition,'OR NOT (CASE entity','OR left(f,7)<>''custom:'' AND NOT (CASE entity');
 END IF;
 SELECT pg_get_functiondef('crm_automation_matches(jsonb,jsonb)'::regprocedure) INTO definition;
 IF position('custom_values' in definition)=0 THEN
  IF position('a:=CASE WHEN' in definition)=0 THEN RAISE EXCEPTION 'Unexpected automation matcher version'; END IF;
  EXECUTE replace(definition,'a:=CASE WHEN','a:=CASE WHEN left(r->>''field'',7)=''custom:'' THEN snapshot->''custom_values''->>substr(r->>''field'',8) WHEN');
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.crm_automation_field_dependency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.archived AND NOT OLD.archived AND EXISTS(SELECT 1 FROM crm_automations a LEFT JOIN crm_automation_versions v ON v.id=a.published_version AND v.organization_id=a.organization_id WHERE a.organization_id=NEW.organization_id AND a.status<>'archived' AND (a.draft::text LIKE '%custom:'||NEW.id::text||'%' OR v.definition::text LIKE '%custom:'||NEW.id::text||'%')) THEN RAISE EXCEPTION 'Update or archive dependent automations first' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_automation_field_dependency() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_automation_field_dependency ON crm_field_definitions;
CREATE TRIGGER crm_automation_field_dependency BEFORE UPDATE ON crm_field_definitions FOR EACH ROW EXECUTE FUNCTION crm_automation_field_dependency();
