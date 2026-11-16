-- Indexed, bounded scheduled checks. A version + record + relevant timestamp
-- is a durable event identity, so repeated sweeps never repeat the same timer.
ALTER TABLE crm_automation_events ADD COLUMN IF NOT EXISTS schedule_key text;
CREATE UNIQUE INDEX IF NOT EXISTS crm_automation_schedule_key ON crm_automation_events(organization_id,schedule_key) WHERE schedule_key IS NOT NULL;
ALTER TABLE crm_automations ADD COLUMN IF NOT EXISTS last_scan_at timestamptz;
CREATE INDEX IF NOT EXISTS crm_automation_scan ON crm_automations(last_scan_at NULLS FIRST) WHERE status='published';
CREATE INDEX IF NOT EXISTS crm_automation_lead_idle ON leads(organization_id,updated_at,id) WHERE deleted_at IS NULL AND status='new' AND converted_at IS NULL;
CREATE INDEX IF NOT EXISTS crm_automation_deal_idle ON deals(organization_id,updated_at,id) WHERE deleted_at IS NULL AND stage NOT IN ('closed_won','closed_lost');
CREATE INDEX IF NOT EXISTS crm_automation_deal_close ON deals(organization_id,expected_close,id) WHERE deleted_at IS NULL AND stage NOT IN ('closed_won','closed_lost');
CREATE INDEX IF NOT EXISTS crm_automation_activity_due ON crm_activities(organization_id,due_at,id) WHERE completed_at IS NULL AND due_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_automation_schedule(p_org uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET timezone='UTC' AS $$
DECLARE a record; item record; table_name text; time_column text; predicate text; entity text; mins integer; eid uuid; safe jsonb; total integer:=0;
BEGIN
 FOR a IN SELECT x.id,x.organization_id,x.published_version,v.definition FROM crm_automations x JOIN crm_automation_versions v ON v.id=x.published_version
  WHERE x.status='published' AND v.definition->>'trigger' IN ('lead.no_response','deal.stalled','deal.closing_soon','activity.overdue') AND (p_org IS NULL OR x.organization_id=p_org)
  ORDER BY x.last_scan_at NULLS FIRST,x.id LIMIT 25 FOR UPDATE OF x SKIP LOCKED
 LOOP
  mins:=coalesce((a.definition->>'scheduleMinutes')::integer,1440);
  CASE a.definition->>'trigger'
   WHEN 'lead.no_response' THEN table_name:='leads';entity:='lead';time_column:='updated_at';predicate:='r.deleted_at IS NULL AND r.status=''new'' AND r.converted_at IS NULL AND r.updated_at <= now()-make_interval(mins=>$3)';
   WHEN 'deal.stalled' THEN table_name:='deals';entity:='deal';time_column:='updated_at';predicate:='r.deleted_at IS NULL AND r.stage NOT IN (''closed_won'',''closed_lost'') AND r.updated_at <= now()-make_interval(mins=>$3)';
   WHEN 'deal.closing_soon' THEN table_name:='deals';entity:='deal';time_column:='expected_close';predicate:='r.deleted_at IS NULL AND r.stage NOT IN (''closed_won'',''closed_lost'') AND r.expected_close>=current_date AND r.expected_close<=current_date+make_interval(mins=>$3)';
   WHEN 'activity.overdue' THEN table_name:='crm_activities';entity:='activity';time_column:='due_at';predicate:='r.completed_at IS NULL AND r.due_at<=now()-make_interval(mins=>$3)';
  END CASE;
  predicate:=predicate||format(' AND NOT EXISTS(SELECT 1 FROM crm_automation_origins o WHERE o.organization_id=r.organization_id AND o.entity=%L AND o.record_id=r.id)',entity);
  -- Identifiers and predicates above are constants, never workflow expressions.
  FOR item IN EXECUTE format('SELECT r.id,to_jsonb(r) snapshot,$2::text||'':''||r.id::text||'':''||r.%I::text event_key FROM public.%I r WHERE r.organization_id=$1 AND %s AND NOT EXISTS(SELECT 1 FROM crm_automation_events e WHERE e.organization_id=$1 AND e.schedule_key=$2::text||'':''||r.id::text||'':''||r.%I::text) ORDER BY r.%I,r.id LIMIT 10',time_column,table_name,predicate,time_column,time_column)
   USING a.organization_id,a.published_version,mins
  LOOP
   SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO safe FROM jsonb_each(item.snapshot) WHERE key IN ('source','status','industry','owner_id','stage','value','currency','expected_close','due_at','completed_at');
   INSERT INTO crm_automation_events(organization_id,trigger,entity,record_id,snapshot,schedule_key) VALUES(a.organization_id,a.definition->>'trigger',entity,item.id,safe,item.event_key)
    ON CONFLICT DO NOTHING RETURNING id INTO eid;
   IF eid IS NOT NULL THEN INSERT INTO crm_automation_runs(organization_id,automation_id,version_id,event_id) VALUES(a.organization_id,a.id,a.published_version,eid) ON CONFLICT DO NOTHING;total:=total+1;END IF;
  END LOOP;
  UPDATE crm_automations SET last_scan_at=now() WHERE id=a.id;
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_schedule(uuid) FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') AND NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='crm-automation-schedules') THEN
  PERFORM cron.schedule('crm-automation-schedules','* * * * *','SELECT public.crm_automation_schedule()');
 END IF;
END $$;
