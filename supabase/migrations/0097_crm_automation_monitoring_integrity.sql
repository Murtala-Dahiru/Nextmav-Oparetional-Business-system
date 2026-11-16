-- Directory filters must describe the executable version, even during draft edits.
ALTER TABLE public.crm_automations ADD COLUMN IF NOT EXISTS effective_trigger text;
CREATE OR REPLACE FUNCTION public.crm_automation_effective_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 NEW.effective_trigger:=NEW.draft->>'trigger';
 IF NEW.published_version IS NOT NULL THEN
  SELECT definition->>'trigger' INTO STRICT NEW.effective_trigger
  FROM crm_automation_versions WHERE id=NEW.published_version AND organization_id=NEW.organization_id AND automation_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_effective_trigger() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS automation_effective_trigger ON public.crm_automations;
CREATE TRIGGER automation_effective_trigger BEFORE INSERT OR UPDATE OF draft,published_version ON public.crm_automations
FOR EACH ROW EXECUTE FUNCTION public.crm_automation_effective_trigger();
UPDATE public.crm_automations a SET effective_trigger=coalesce(
 (SELECT v.definition->>'trigger' FROM crm_automation_versions v WHERE v.id=a.published_version AND v.organization_id=a.organization_id),a.draft->>'trigger');
CREATE INDEX IF NOT EXISTS crm_automation_effective_trigger_index ON public.crm_automations(organization_id,effective_trigger,updated_at DESC);

-- Preserve the condition explanation at each committed step, including rechecks.
-- Old steps stay NULL: we cannot reconstruct historical evaluations honestly.
ALTER TABLE public.crm_automation_steps ADD COLUMN IF NOT EXISTS condition_results jsonb;
CREATE OR REPLACE FUNCTION public.crm_automation_step_conditions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 SELECT condition_results INTO STRICT NEW.condition_results FROM crm_automation_runs
 WHERE id=NEW.run_id AND organization_id=NEW.organization_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_step_conditions() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS automation_step_conditions ON public.crm_automation_steps;
CREATE TRIGGER automation_step_conditions BEFORE INSERT ON public.crm_automation_steps
FOR EACH ROW EXECUTE FUNCTION public.crm_automation_step_conditions();
