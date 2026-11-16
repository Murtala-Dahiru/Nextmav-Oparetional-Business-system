-- Event-maintained account timers avoid repeatedly polling all customer records.
CREATE TABLE IF NOT EXISTS crm_automation_account_timers (
 organization_id uuid NOT NULL REFERENCES organizations(id), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('inactive','action_overdue')), item_id uuid NOT NULL,
 anchor_at timestamptz NOT NULL, PRIMARY KEY(organization_id,company_id,kind,item_id)
);
CREATE INDEX IF NOT EXISTS crm_automation_account_timer_due ON crm_automation_account_timers(organization_id,kind,anchor_at);
ALTER TABLE crm_automation_account_timers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_automation_account_timers FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS account_timer_deny ON public.crm_automation_account_timers;
CREATE POLICY account_timer_deny ON public.crm_automation_account_timers FOR ALL TO authenticated USING(false) WITH CHECK(false);

CREATE OR REPLACE FUNCTION public.crm_automation_account_timer_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET timezone='UTC' AS $$
DECLARE company uuid; item jsonb; engagement timestamptz;
BEGIN
 IF TG_TABLE_NAME='companies' THEN
  INSERT INTO crm_automation_account_timers VALUES(NEW.organization_id,NEW.id,'inactive',NEW.id,NEW.created_at) ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='crm_account_plans' THEN
  IF nullif(current_setting('nextmav.automation_run',true),'') IS NOT NULL THEN RETURN NEW;END IF;
  DELETE FROM crm_automation_account_timers WHERE organization_id=NEW.organization_id AND company_id=NEW.company_id AND kind='action_overdue';
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
   IF item->>'kind'='action' AND item->>'status'<>'completed' AND nullif(item->>'dueDate','') IS NOT NULL THEN
    INSERT INTO crm_automation_account_timers VALUES(NEW.organization_id,NEW.company_id,'action_overdue',(item->>'id')::uuid,(item->>'dueDate')::date+interval '1 day') ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;
 ELSE
  IF NEW.activity_type NOT IN ('call','email','meeting') OR (NEW.due_at IS NOT NULL AND NEW.completed_at IS NULL) THEN RETURN NEW;END IF;
  IF TG_OP='UPDATE' AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at THEN RETURN NEW;END IF;
  company:=NEW.company_id;
  IF company IS NULL AND NEW.contact_id IS NOT NULL THEN SELECT company_id INTO company FROM contacts WHERE id=NEW.contact_id AND organization_id=NEW.organization_id;END IF;
  IF company IS NULL AND NEW.deal_id IS NOT NULL THEN SELECT company_id INTO company FROM deals WHERE id=NEW.deal_id AND organization_id=NEW.organization_id;END IF;
  IF company IS NOT NULL THEN
   engagement:=coalesce(NEW.completed_at,NEW.created_at);
   INSERT INTO crm_automation_account_timers VALUES(NEW.organization_id,company,'inactive',company,engagement)
   ON CONFLICT(organization_id,company_id,kind,item_id) DO UPDATE SET anchor_at=greatest(crm_automation_account_timers.anchor_at,excluded.anchor_at);
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_account_timer_capture() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS automation_account_timer ON companies;
CREATE TRIGGER automation_account_timer AFTER INSERT ON companies FOR EACH ROW EXECUTE FUNCTION crm_automation_account_timer_capture();
DROP TRIGGER IF EXISTS automation_account_timer ON crm_activities;
CREATE TRIGGER automation_account_timer AFTER INSERT OR UPDATE ON crm_activities FOR EACH ROW EXECUTE FUNCTION crm_automation_account_timer_capture();
DROP TRIGGER IF EXISTS automation_account_timer ON crm_account_plans;
CREATE TRIGGER automation_account_timer AFTER INSERT OR UPDATE OF items ON crm_account_plans FOR EACH ROW EXECUTE FUNCTION crm_automation_account_timer_capture();

-- Initial projections only; no existing CRM record is modified.
INSERT INTO crm_automation_account_timers
SELECT c.organization_id,c.id,'inactive',c.id,greatest(c.created_at,coalesce(max(coalesce(a.completed_at,a.created_at)),c.created_at))
FROM companies c LEFT JOIN crm_activities a ON a.organization_id=c.organization_id AND (a.company_id=c.id OR a.contact_id IN(SELECT id FROM contacts WHERE organization_id=c.organization_id AND company_id=c.id) OR a.deal_id IN(SELECT id FROM deals WHERE organization_id=c.organization_id AND company_id=c.id))
AND a.activity_type IN ('call','email','meeting') AND (a.due_at IS NULL OR a.completed_at IS NOT NULL)
WHERE c.deleted_at IS NULL GROUP BY c.organization_id,c.id,c.created_at ON CONFLICT DO NOTHING;
INSERT INTO crm_automation_account_timers
SELECT p.organization_id,p.company_id,'action_overdue',(item->>'id')::uuid,(item->>'dueDate')::date+interval '1 day'
FROM crm_account_plans p CROSS JOIN LATERAL jsonb_array_elements(p.items) item
WHERE item->>'kind'='action' AND item->>'status'<>'completed' AND nullif(item->>'dueDate','') IS NOT NULL ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.crm_automation_account_schedule(p_org uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET timezone='UTC' AS $$
DECLARE a record;t record; eid uuid;total integer:=0;mins integer;
BEGIN
 FOR a IN SELECT x.id,x.organization_id,x.published_version,v.definition FROM crm_automations x JOIN crm_automation_versions v ON v.id=x.published_version
 WHERE x.status='published' AND v.definition->>'trigger' IN ('company.inactive','company.action_overdue') AND (p_org IS NULL OR x.organization_id=p_org)
 ORDER BY x.last_scan_at NULLS FIRST,x.id LIMIT 25 FOR UPDATE OF x SKIP LOCKED LOOP
  mins:=coalesce((a.definition->>'scheduleMinutes')::integer,1440);
  FOR t IN SELECT timer.*,c.owner_id,c.industry,c.crm_profile,
   a.published_version::text||':'||timer.company_id||':'||timer.item_id||':'||timer.anchor_at::text AS event_key
   FROM crm_automation_account_timers timer JOIN companies c ON c.id=timer.company_id AND c.organization_id=timer.organization_id
   WHERE timer.organization_id=a.organization_id AND timer.kind=split_part(a.definition->>'trigger','.',2) AND c.deleted_at IS NULL AND timer.anchor_at<=now()-make_interval(mins=>mins)
   AND NOT EXISTS(SELECT 1 FROM crm_automation_origins o WHERE o.organization_id=timer.organization_id AND o.entity='company' AND o.record_id=timer.company_id)
   AND NOT EXISTS(SELECT 1 FROM crm_automation_events e WHERE e.organization_id=a.organization_id AND e.schedule_key=a.published_version::text||':'||timer.company_id||':'||timer.item_id||':'||timer.anchor_at::text)
   ORDER BY timer.anchor_at,timer.company_id,timer.item_id LIMIT 10 LOOP
    INSERT INTO crm_automation_events(organization_id,trigger,entity,record_id,snapshot,schedule_key)
    VALUES(a.organization_id,a.definition->>'trigger','company',t.company_id,jsonb_build_object('owner_id',t.owner_id,'industry',t.industry,'segment',t.crm_profile->'segment','due_at',t.anchor_at,'timerItemId',t.item_id,'timerAnchor',t.anchor_at),t.event_key)
    ON CONFLICT DO NOTHING RETURNING id INTO eid;
    IF eid IS NOT NULL THEN INSERT INTO crm_automation_runs(organization_id,automation_id,version_id,event_id) VALUES(a.organization_id,a.id,a.published_version,eid) ON CONFLICT DO NOTHING;total:=total+1;END IF;
  END LOOP;
  UPDATE crm_automations SET last_scan_at=now() WHERE id=a.id;
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_account_schedule(uuid) FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') AND NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='crm-automation-account-schedules') THEN
  PERFORM cron.schedule('crm-automation-account-schedules','* * * * *','SELECT public.crm_automation_account_schedule()');
 END IF;
END $$;
