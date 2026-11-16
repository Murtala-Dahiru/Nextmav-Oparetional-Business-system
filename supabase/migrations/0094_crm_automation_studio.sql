-- Automation Studio. Durable capture + atomic database steps; no client timers.
CREATE TABLE IF NOT EXISTS crm_automations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 owner_id uuid NOT NULL REFERENCES organization_members(id), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 description text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','paused','archived')),
 revision integer NOT NULL DEFAULT 1, draft jsonb NOT NULL, published_version uuid,
 last_alert_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS crm_automation_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, automation_id uuid NOT NULL,
 definition jsonb NOT NULL, published_by uuid NOT NULL REFERENCES organization_members(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,automation_id) REFERENCES crm_automations(organization_id,id), UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS crm_automation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 trigger text NOT NULL, entity text NOT NULL, record_id uuid NOT NULL, snapshot jsonb NOT NULL,
 causation_id uuid, depth integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS crm_automation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, automation_id uuid NOT NULL,
 version_id uuid NOT NULL, event_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','waiting','retrying','succeeded','skipped','failed','cancelled')),
 cursor integer NOT NULL DEFAULT 0, matched boolean, attempts integer NOT NULL DEFAULT 0, retry_count integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz,
 error_code text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,automation_id) REFERENCES crm_automations(organization_id,id),
 FOREIGN KEY(organization_id,version_id) REFERENCES crm_automation_versions(organization_id,id),
 FOREIGN KEY(organization_id,event_id) REFERENCES crm_automation_events(organization_id,id),
 UNIQUE(automation_id,event_id), UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS crm_automation_steps (
 organization_id uuid NOT NULL, run_id uuid NOT NULL, position integer NOT NULL,
 action text NOT NULL, outcome text NOT NULL, affected_id text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,position), FOREIGN KEY(organization_id,run_id) REFERENCES crm_automation_runs(organization_id,id)
);
CREATE TABLE IF NOT EXISTS crm_automation_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id uuid NOT NULL, automation_id uuid NOT NULL,
 actor_id uuid REFERENCES organization_members(id), operation text NOT NULL, revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,automation_id) REFERENCES crm_automations(organization_id,id)
);
CREATE TABLE IF NOT EXISTS crm_automation_origins (
 organization_id uuid NOT NULL REFERENCES organizations(id),entity text NOT NULL,record_id uuid NOT NULL,
 run_id uuid NOT NULL,PRIMARY KEY(organization_id,entity,record_id)
);
ALTER TABLE crm_automation_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_automation_origins FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS automation_origins_deny ON public.crm_automation_origins;
CREATE POLICY automation_origins_deny ON public.crm_automation_origins FOR ALL TO authenticated USING(false) WITH CHECK(false);
CREATE INDEX IF NOT EXISTS crm_automation_directory ON crm_automations(organization_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_automation_trigger ON crm_automations(organization_id,((draft->>'trigger'))) WHERE status='published';
CREATE INDEX IF NOT EXISTS crm_automation_due ON crm_automation_runs(available_at,organization_id) WHERE status IN ('pending','waiting','retrying');
CREATE INDEX IF NOT EXISTS crm_automation_history ON crm_automation_runs(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS crm_automation_workflow_history ON crm_automation_runs(automation_id,created_at DESC);
CREATE INDEX IF NOT EXISTS crm_automation_event_history ON crm_automation_events(organization_id,created_at);
ALTER TABLE crm_automation_runs ADD COLUMN IF NOT EXISTS error_action text;
ALTER TABLE crm_automation_runs ADD COLUMN IF NOT EXISTS condition_results jsonb NOT NULL DEFAULT '[]';
ALTER TABLE crm_automations ADD COLUMN IF NOT EXISTS execution_count bigint NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS last_run_at timestamptz, ADD COLUMN IF NOT EXISTS last_outcome text;

CREATE OR REPLACE FUNCTION public.crm_automation_admin(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM organization_members m JOIN profiles p ON p.id=m.user_id JOIN organizations o ON o.id=m.organization_id
 WHERE m.organization_id=p_org AND m.user_id=auth.uid() AND m.is_active AND m.deleted_at IS NULL AND m.role IN ('owner','administrator') AND p.is_active AND p.auth_deleted_at IS NULL AND o.deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION public.crm_automation_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_automation_admin(uuid) TO authenticated;
ALTER TABLE public.crm_automations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_automations FROM anon,authenticated;
GRANT SELECT ON public.crm_automations TO authenticated;
DROP POLICY IF EXISTS automation_admin_read ON public.crm_automations;
CREATE POLICY automation_admin_read ON public.crm_automations FOR SELECT TO authenticated USING(public.crm_automation_admin(organization_id));
ALTER TABLE public.crm_automation_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_automation_versions FROM anon,authenticated;
GRANT SELECT ON public.crm_automation_versions TO authenticated;
DROP POLICY IF EXISTS automation_admin_read ON public.crm_automation_versions;
CREATE POLICY automation_admin_read ON public.crm_automation_versions FOR SELECT TO authenticated USING(public.crm_automation_admin(organization_id));
ALTER TABLE public.crm_automation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_automation_events FROM anon,authenticated;
GRANT SELECT ON public.crm_automation_events TO authenticated;
DROP POLICY IF EXISTS automation_admin_read ON public.crm_automation_events;
CREATE POLICY automation_admin_read ON public.crm_automation_events FOR SELECT TO authenticated USING(public.crm_automation_admin(organization_id));
ALTER TABLE public.crm_automation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_automation_runs FROM anon,authenticated;
GRANT SELECT ON public.crm_automation_runs TO authenticated;
DROP POLICY IF EXISTS automation_admin_read ON public.crm_automation_runs;
CREATE POLICY automation_admin_read ON public.crm_automation_runs FOR SELECT TO authenticated USING(public.crm_automation_admin(organization_id));
ALTER TABLE public.crm_automation_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_automation_steps FROM anon,authenticated;
GRANT SELECT ON public.crm_automation_steps TO authenticated;
DROP POLICY IF EXISTS automation_admin_read ON public.crm_automation_steps;
CREATE POLICY automation_admin_read ON public.crm_automation_steps FOR SELECT TO authenticated USING(public.crm_automation_admin(organization_id));
ALTER TABLE public.crm_automation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_automation_audit FROM anon,authenticated;
GRANT SELECT ON public.crm_automation_audit TO authenticated;
DROP POLICY IF EXISTS automation_admin_read ON public.crm_automation_audit;
CREATE POLICY automation_admin_read ON public.crm_automation_audit FOR SELECT TO authenticated USING(public.crm_automation_admin(organization_id));

-- SQL validation is authoritative even when callers bypass the HTTP API.
CREATE OR REPLACE FUNCTION public.crm_automation_validate(w jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s jsonb; g jsonb; r jsonb; entity text:=split_part(w->>'trigger','.',1); f text; op text; v text;
BEGIN
 IF w IS NULL OR pg_column_size(w)>32000 OR coalesce(w->>'trigger','') NOT IN
 ('lead.created','lead.assigned','lead.status_changed','lead.qualified','lead.converted','lead.no_response','company.created','company.inactive','company.action_overdue','company.owner_changed','contact.created','contact.relationship_updated','deal.created','deal.stage_changed','deal.won','deal.lost','deal.owner_changed','deal.closing_soon','deal.stalled','activity.created','activity.completed','activity.meeting_scheduled','activity.overdue')
 OR jsonb_typeof(w->'steps') IS DISTINCT FROM 'array' OR jsonb_array_length(w->'steps') NOT BETWEEN 1 AND 20
 OR coalesce(w->'conditions'->>'mode','') NOT IN ('all','any') OR jsonb_typeof(w->'conditions'->'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(w->'conditions'->'groups')>4 THEN
 RAISE EXCEPTION 'Invalid workflow structure' USING ERRCODE='22023'; END IF;
 IF coalesce((w->>'scheduleMinutes')::integer,1440) NOT BETWEEN 1 AND 43200 THEN RAISE EXCEPTION 'Invalid schedule window' USING ERRCODE='22023';END IF;
 IF (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(w->'steps') x)<>jsonb_array_length(w->'steps') THEN RAISE EXCEPTION 'Duplicate step identity' USING ERRCODE='22023';END IF;
 FOR g IN SELECT * FROM jsonb_array_elements(w->'conditions'->'groups') LOOP
  IF coalesce(g->>'mode','') NOT IN ('all','any') OR jsonb_typeof(g->'rules') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'rules')>12 THEN RAISE EXCEPTION 'Invalid condition group' USING ERRCODE='22023'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(g->'rules') LOOP
   f:=r->>'field';op:=r->>'operator';v:=coalesce(r->>'value','');
   IF f IS NULL OR NOT (CASE entity WHEN 'lead' THEN f IN ('source','status','industry','owner_id') WHEN 'deal' THEN f IN ('stage','value','currency','expected_close','owner_id') WHEN 'company' THEN f IN ('industry','owner_id','segment','due_at') WHEN 'contact' THEN f IN ('owner_id','relationshipRole','influence') WHEN 'activity' THEN f IN ('due_at','completed_at') ELSE false END)
    OR coalesce(op,'') NOT IN ('equals','not_equals','contains','in','greater','less','before','after','empty','not_empty') OR length(v)>500 THEN RAISE EXCEPTION 'Unsupported condition' USING ERRCODE='22023'; END IF;
   IF op IN ('greater','less') THEN IF f<>'value' OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN RAISE EXCEPTION 'Invalid numeric comparison' USING ERRCODE='22023';END IF;END IF;
   IF op IN ('before','after') THEN IF f NOT IN ('expected_close','due_at','completed_at') OR v !~ '^\d{4}-\d{2}-\d{2}' THEN RAISE EXCEPTION 'Invalid date comparison' USING ERRCODE='22023';END IF;PERFORM v::timestamptz;END IF;
   IF op IN ('contains','in') AND f IN ('value','expected_close','due_at','completed_at') THEN RAISE EXCEPTION 'Invalid text comparison' USING ERRCODE='22023';END IF;
   IF op IN ('equals','not_equals') AND f='value' AND v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN RAISE EXCEPTION 'Numeric equality requires a number' USING ERRCODE='22023';END IF;
   IF op IN ('equals','not_equals') AND f IN ('expected_close','due_at','completed_at') THEN
    IF v !~ '^\d{4}-\d{2}-\d{2}' THEN RAISE EXCEPTION 'Date equality requires a date' USING ERRCODE='22023';END IF;PERFORM v::timestamptz;
   END IF;
  END LOOP;
 END LOOP;
 FOR s IN SELECT * FROM jsonb_array_elements(w->'steps') LOOP
  PERFORM (s->>'id')::uuid;
  IF s->>'id' IS NULL OR coalesce(s->>'type','') NOT IN ('assign_lead','reassign_lead','assign_owner','create_task','notify','wait','check','update_next_step','update_lead_status','add_tag','create_account_action') OR coalesce(s->>'branch','') NOT IN ('always','matched','unmatched')
   OR coalesce((s->>'minutes')::integer,0) NOT BETWEEN 1 AND 43200 OR length(coalesce(s->>'text',''))>250 THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
  IF s->>'type' IN ('assign_lead','reassign_lead','update_lead_status') AND entity<>'lead' OR s->>'type'='assign_owner' AND entity NOT IN ('deal','company') OR s->>'type'='update_next_step' AND entity<>'deal' THEN RAISE EXCEPTION 'Action incompatible with trigger' USING ERRCODE='22023';END IF;
  IF s->>'type'='create_account_action' AND (entity<>'company' OR btrim(coalesce(s->>'text',''))='') THEN RAISE EXCEPTION 'Account action requires a company and title' USING ERRCODE='22023';END IF;
  IF s->>'type'='add_tag' AND (entity NOT IN ('company','contact') OR length(btrim(coalesce(s->>'text',''))) NOT BETWEEN 1 AND 60) THEN RAISE EXCEPTION 'Invalid account/contact tag' USING ERRCODE='22023';END IF;
  IF s->>'type'='update_lead_status' AND coalesce(s->>'text','') NOT IN ('new','contacted','qualified','proposal','negotiation','won','lost') THEN RAISE EXCEPTION 'Invalid lead status' USING ERRCODE='22023';END IF;
  IF s->>'type' IN ('assign_owner','notify') AND nullif(s->>'memberId','') IS NULL THEN RAISE EXCEPTION 'Recipient required' USING ERRCODE='22023';END IF;
  IF nullif(s->>'memberId','') IS NOT NULL THEN PERFORM (s->>'memberId')::uuid;END IF;
  IF s->>'type' IN ('create_task','notify','update_next_step') AND btrim(coalesce(s->>'text',''))='' THEN RAISE EXCEPTION 'Action description required' USING ERRCODE='22023';END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_validate(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.crm_automation_matches(c jsonb, snapshot jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE g jsonb; r jsonb; a text; b text; match boolean; gm boolean; result boolean:=c->>'mode'='all';
BEGIN
 IF jsonb_array_length(c->'groups')=0 THEN RETURN true;END IF;
 FOR g IN SELECT * FROM jsonb_array_elements(c->'groups') LOOP
  gm:=g->>'mode'='all';
  FOR r IN SELECT * FROM jsonb_array_elements(g->'rules') LOOP
   a:=CASE WHEN r->>'field' IN ('segment','relationshipRole','influence') THEN coalesce(snapshot->>(r->>'field'),snapshot->'crm_profile'->>(r->>'field')) ELSE snapshot->>(r->>'field') END;b:=r->>'value';
   match:=coalesce(CASE r->>'operator'
    WHEN 'equals' THEN CASE WHEN r->>'field'='value' THEN a::numeric=b::numeric WHEN r->>'field' IN ('expected_close','due_at','completed_at') THEN a::timestamptz=b::timestamptz ELSE a=b END
    WHEN 'not_equals' THEN CASE WHEN r->>'field'='value' THEN a::numeric<>b::numeric WHEN r->>'field' IN ('expected_close','due_at','completed_at') THEN a::timestamptz<>b::timestamptz ELSE a<>b END WHEN 'contains' THEN position(lower(b) in lower(a))>0
    WHEN 'in' THEN a=ANY(regexp_split_to_array(b,'\s*,\s*'))
    WHEN 'greater' THEN a::numeric>b::numeric WHEN 'less' THEN a::numeric<b::numeric
    WHEN 'before' THEN a::timestamptz<b::timestamptz WHEN 'after' THEN a::timestamptz>b::timestamptz
    WHEN 'empty' THEN coalesce(a,'')='' WHEN 'not_empty' THEN coalesce(a,'')<>'' ELSE false END,false);
   IF g->>'mode'='all' THEN gm:=gm AND match;ELSE gm:=gm OR match;END IF;
  END LOOP;
  IF c->>'mode'='all' THEN result:=result AND gm;ELSE result:=result OR gm;END IF;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_matches(jsonb,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.crm_automation_explain(c jsonb,snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE g jsonb;r jsonb;result jsonb:='[]';gi integer:=0;ri integer;
BEGIN
 FOR g IN SELECT * FROM jsonb_array_elements(c->'groups') LOOP
  gi:=gi+1;ri:=0;
  FOR r IN SELECT * FROM jsonb_array_elements(g->'rules') LOOP
   ri:=ri+1;result:=result||jsonb_build_array(jsonb_build_object('group',gi,'condition',ri,'field',r->>'field','operator',r->>'operator','matched',crm_automation_matches(jsonb_build_object('mode','all','groups',jsonb_build_array(jsonb_build_object('mode','all','rules',jsonb_build_array(r)))),snapshot)));
  END LOOP;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_explain(jsonb,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.crm_automation_save(p_org uuid,p_id uuid,p_revision integer,p_name text,p_description text,p_definition jsonb,p_operation text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a crm_automations%ROWTYPE; v uuid; s jsonb; g jsonb; r jsonb;
BEGIN
 IF NOT public.crm_automation_admin(p_org) THEN RAISE EXCEPTION 'Automation management not permitted' USING ERRCODE='42501';END IF;
 IF p_operation NOT IN ('save','publish','pause','resume','archive') OR p_operation IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR length(coalesce(p_description,''))>1000 OR p_definition IS NULL OR pg_column_size(p_definition)>32000 THEN RAISE EXCEPTION 'Invalid automation request' USING ERRCODE='22023';END IF;
 IF p_operation IN ('save','publish') THEN
  IF jsonb_typeof(p_definition->'trigger') IS DISTINCT FROM 'string' OR jsonb_typeof(p_definition->'steps') IS DISTINCT FROM 'array' OR jsonb_array_length(p_definition->'steps')>20
   OR coalesce(p_definition->'conditions'->>'mode','') NOT IN ('all','any') OR jsonb_typeof(p_definition->'conditions'->'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(p_definition->'conditions'->'groups')>4 THEN RAISE EXCEPTION 'Invalid draft structure' USING ERRCODE='22023';END IF;
  FOR s IN SELECT * FROM jsonb_array_elements(p_definition->'steps') LOOP
   IF s->>'id' IS NULL OR coalesce(s->>'type','') NOT IN ('assign_lead','reassign_lead','assign_owner','create_task','notify','wait','check','update_next_step','update_lead_status','add_tag','create_account_action') OR jsonb_typeof(s->'text') IS DISTINCT FROM 'string' OR coalesce(s->>'branch','') NOT IN ('always','matched','unmatched') OR coalesce((s->>'minutes')::integer,0) NOT BETWEEN 1 AND 43200 OR jsonb_typeof(s->'memberId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid draft step' USING ERRCODE='22023';END IF;
   PERFORM (s->>'id')::uuid;
  END LOOP;
  FOR g IN SELECT * FROM jsonb_array_elements(p_definition->'conditions'->'groups') LOOP
   IF coalesce(g->>'mode','') NOT IN ('all','any') OR jsonb_typeof(g->'rules') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'rules')>12 THEN RAISE EXCEPTION 'Invalid draft group' USING ERRCODE='22023';END IF;
   FOR r IN SELECT * FROM jsonb_array_elements(g->'rules') LOOP
    IF jsonb_typeof(r->'field') IS DISTINCT FROM 'string' OR jsonb_typeof(r->'operator') IS DISTINCT FROM 'string' OR jsonb_typeof(r->'value') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid draft condition' USING ERRCODE='22023';END IF;
   END LOOP;
  END LOOP;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('automation-config:'||p_org,0));
 IF p_id IS NULL THEN
  IF p_revision<>0 OR p_revision IS NULL OR p_operation NOT IN ('save','publish') THEN RAISE EXCEPTION 'Invalid new automation' USING ERRCODE='22023';END IF;
  IF (SELECT count(*) FROM crm_automations WHERE organization_id=p_org AND status<>'archived')>=100 THEN RAISE EXCEPTION 'Automation limit reached' USING ERRCODE='54000';END IF;
  INSERT INTO crm_automations(organization_id,owner_id,name,description,draft) VALUES(p_org,public.auth_member_id(p_org),p_name,coalesce(p_description,''),p_definition) RETURNING * INTO a;
 ELSE
  SELECT * INTO a FROM crm_automations WHERE id=p_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Automation not found' USING ERRCODE='P0002';END IF;
  IF a.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Automation revision changed' USING ERRCODE='PT409';END IF;
  IF a.status='archived' THEN RAISE EXCEPTION 'Archived automation is read only; duplicate it' USING ERRCODE='22023';END IF;
 END IF;
 IF p_operation='publish' THEN
  IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN RAISE EXCEPTION 'Database scheduler must be configured before publishing' USING ERRCODE='55000';END IF;
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='crm-automation-worker' AND active) THEN RAISE EXCEPTION 'Automation worker schedule is inactive' USING ERRCODE='55000';END IF;
  IF p_definition->>'trigger' IN ('lead.no_response','deal.stalled','deal.closing_soon','activity.overdue') AND NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='crm-automation-schedules' AND active) THEN RAISE EXCEPTION 'CRM timer schedule is inactive' USING ERRCODE='55000';END IF;
  IF p_definition->>'trigger' IN ('company.inactive','company.action_overdue') AND NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='crm-automation-account-schedules' AND active) THEN RAISE EXCEPTION 'Account timer schedule is inactive' USING ERRCODE='55000';END IF;
  PERFORM public.crm_automation_validate(p_definition);
  FOR s IN SELECT * FROM jsonb_array_elements(p_definition->'steps') LOOP
   IF nullif(s->>'memberId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_members WHERE id=(s->>'memberId')::uuid AND organization_id=p_org AND is_active AND deleted_at IS NULL AND role IN ('owner','administrator','manager','sales_staff')) THEN RAISE EXCEPTION 'Recipient must be an active CRM member in this organization' USING ERRCODE='22023';END IF;
  END LOOP;
  INSERT INTO crm_automation_versions(organization_id,automation_id,definition,published_by) VALUES(p_org,a.id,p_definition,public.auth_member_id(p_org)) RETURNING id INTO v;
 ELSIF p_operation='resume' AND (a.status<>'paused' OR a.published_version IS NULL) OR p_operation='pause' AND a.status<>'published' THEN RAISE EXCEPTION 'Invalid lifecycle transition' USING ERRCODE='22023';END IF;
 UPDATE crm_automations SET name=CASE WHEN p_operation IN ('save','publish') THEN p_name ELSE name END,
  description=CASE WHEN p_operation IN ('save','publish') THEN coalesce(p_description,'') ELSE description END,
  draft=CASE WHEN p_operation IN ('save','publish') THEN p_definition ELSE draft END,
  revision=revision+1,updated_at=now(),published_version=coalesce(v,published_version),
  status=CASE p_operation WHEN 'publish' THEN 'published' WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'published' WHEN 'archive' THEN 'archived' ELSE status END WHERE id=a.id;
 IF p_operation='archive' THEN UPDATE crm_automation_runs SET status='cancelled',completed_at=now() WHERE automation_id=a.id AND status IN ('pending','waiting','retrying');END IF;
 INSERT INTO crm_automation_audit(organization_id,automation_id,actor_id,operation,revision) VALUES(p_org,a.id,public.auth_member_id(p_org),p_operation,a.revision+1);
 RETURN a.id;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_save(uuid,uuid,integer,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_automation_save(uuid,uuid,integer,text,text,jsonb,text) TO authenticated;

-- Called only by database triggers. Generated record effects carry causation and
-- are captured for audit but never fan out: maximum automatic chain depth is 1.
CREATE OR REPLACE FUNCTION public.crm_automation_emit(p_org uuid,p_trigger text,p_entity text,p_record uuid,p_snapshot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE eid uuid; cause uuid:=nullif(current_setting('nextmav.automation_run',true),'')::uuid; safe jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crm_automations a JOIN crm_automation_versions v ON v.id=a.published_version WHERE a.organization_id=p_org AND a.status='published' AND v.definition->>'trigger'=p_trigger) THEN RETURN;END IF;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO safe FROM jsonb_each(p_snapshot) WHERE key IN ('source','status','industry','owner_id','stage','value','currency','expected_close','due_at','completed_at');
 safe:=safe||jsonb_build_object('segment',p_snapshot->'crm_profile'->'segment','relationshipRole',p_snapshot->'crm_profile'->'relationshipRole','influence',p_snapshot->'crm_profile'->'influence');
 INSERT INTO crm_automation_events(organization_id,trigger,entity,record_id,snapshot,causation_id,depth) VALUES(p_org,p_trigger,p_entity,p_record,safe,cause,CASE WHEN cause IS NULL THEN 0 ELSE 1 END) RETURNING id INTO eid;
 IF cause IS NOT NULL THEN RETURN;END IF;
 INSERT INTO crm_automation_runs(organization_id,automation_id,version_id,event_id)
 SELECT p_org,a.id,v.id,eid FROM crm_automations a JOIN crm_automation_versions v ON v.id=a.published_version
 WHERE a.organization_id=p_org AND a.status='published' AND v.definition->>'trigger'=p_trigger
 ON CONFLICT(automation_id,event_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_emit(uuid,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- Retain an explicit failed run when a workflow exceeds its intake quota.
-- Never fail a customer record write or silently discard the captured event.
CREATE OR REPLACE FUNCTION public.crm_automation_intake_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('automation-intake:'||NEW.automation_id,0));
 IF (SELECT count(*) FROM crm_automation_runs WHERE automation_id=NEW.automation_id AND created_at>now()-interval '1 hour')>=1000 THEN
  NEW.status:='failed';NEW.error_code:='PT429';NEW.error_action:='intake';NEW.completed_at:=now();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_intake_limit() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS crm_automation_intake_limit ON crm_automation_runs;
CREATE TRIGGER crm_automation_intake_limit BEFORE INSERT ON crm_automation_runs FOR EACH ROW EXECUTE FUNCTION public.crm_automation_intake_limit();

CREATE OR REPLACE FUNCTION public.crm_automation_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_variable
DECLARE n jsonb:=to_jsonb(NEW); o jsonb; entity text:=CASE TG_TABLE_NAME WHEN 'leads' THEN 'lead' WHEN 'deals' THEN 'deal' WHEN 'companies' THEN 'company' WHEN 'contacts' THEN 'contact' ELSE 'activity' END;
BEGIN
 IF nullif(current_setting('nextmav.automation_run',true),'') IS NOT NULL THEN
  INSERT INTO crm_automation_origins(organization_id,entity,record_id,run_id) VALUES(NEW.organization_id,entity,NEW.id,current_setting('nextmav.automation_run')::uuid)
   ON CONFLICT ON CONSTRAINT crm_automation_origins_pkey DO UPDATE SET run_id=excluded.run_id;
 ELSE DELETE FROM crm_automation_origins WHERE organization_id=NEW.organization_id AND crm_automation_origins.entity=entity AND record_id=NEW.id;END IF;
 IF n->>'deleted_at' IS NOT NULL THEN RETURN NEW;END IF;
 IF TG_OP='INSERT' THEN
  PERFORM crm_automation_emit(NEW.organization_id,entity||'.created',entity,NEW.id,n);
  IF entity='activity' AND n->>'activity_type'='meeting' AND n->>'due_at' IS NOT NULL THEN PERFORM crm_automation_emit(NEW.organization_id,'activity.meeting_scheduled',entity,NEW.id,n);END IF;
  RETURN NEW;
 END IF;
 o:=to_jsonb(OLD);
 IF entity='contact' AND n->'crm_profile' IS DISTINCT FROM o->'crm_profile' THEN PERFORM crm_automation_emit(NEW.organization_id,'contact.relationship_updated',entity,NEW.id,n);END IF;
 IF entity='activity' AND n->>'activity_type'='meeting' AND n->>'due_at' IS NOT NULL AND (n->'due_at' IS DISTINCT FROM o->'due_at' OR n->'activity_type' IS DISTINCT FROM o->'activity_type') THEN PERFORM crm_automation_emit(NEW.organization_id,'activity.meeting_scheduled',entity,NEW.id,n);END IF;
 IF entity IN ('lead','deal','company') AND n->'owner_id' IS DISTINCT FROM o->'owner_id' THEN PERFORM crm_automation_emit(NEW.organization_id,entity||CASE WHEN entity='lead' THEN '.assigned' ELSE '.owner_changed' END,entity,NEW.id,n);END IF;
 IF entity='lead' THEN
  IF n->'status' IS DISTINCT FROM o->'status' THEN
   PERFORM crm_automation_emit(NEW.organization_id,'lead.status_changed',entity,NEW.id,n);
   IF n->>'status'='qualified' THEN PERFORM crm_automation_emit(NEW.organization_id,'lead.qualified',entity,NEW.id,n);END IF;
  END IF;
  IF n->>'converted_at' IS NOT NULL AND o->>'converted_at' IS NULL THEN PERFORM crm_automation_emit(NEW.organization_id,'lead.converted',entity,NEW.id,n);END IF;
 ELSIF entity='deal' AND (n->'pipeline_stage_id' IS DISTINCT FROM o->'pipeline_stage_id' OR n->'stage' IS DISTINCT FROM o->'stage') THEN
  PERFORM crm_automation_emit(NEW.organization_id,'deal.stage_changed',entity,NEW.id,n);
  IF n->>'stage' IN ('closed_won','closed_lost') THEN PERFORM crm_automation_emit(NEW.organization_id,CASE WHEN n->>'stage'='closed_won' THEN 'deal.won' ELSE 'deal.lost' END,entity,NEW.id,n);END IF;
 ELSIF entity='activity' AND n->>'completed_at' IS NOT NULL AND o->>'completed_at' IS NULL THEN PERFORM crm_automation_emit(NEW.organization_id,'activity.completed',entity,NEW.id,n);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_capture() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['leads','deals','companies','contacts','crm_activities'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS crm_automation_capture ON public.%I',t);
  EXECUTE format('CREATE TRIGGER crm_automation_capture AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.crm_automation_capture()',t);
 END LOOP;
END $$;

-- One step and its effects commit together. SKIP LOCKED + unique step positions
-- make retries safe; crash before commit rolls back both effect and progress.
CREATE OR REPLACE FUNCTION public.crm_automation_worker(p_limit integer DEFAULT 50,p_org uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job record; e crm_automation_events%ROWTYPE; s jsonb; live jsonb; recipient uuid; affected text; outcome text; code text; count_done integer:=0; plan_data jsonb; publisher_user uuid; previous_claims text:=current_setting('request.jwt.claims',true); previous_cause text:=current_setting('nextmav.automation_run',true);
BEGIN
 FOR job IN
  WITH eligible AS (
   SELECT r.id,row_number() OVER(PARTITION BY r.organization_id ORDER BY r.available_at,r.id) AS tenant_position
   FROM crm_automation_runs r JOIN crm_automations a ON a.id=r.automation_id
   WHERE r.status IN ('pending','waiting','retrying') AND r.available_at<=now() AND a.status='published' AND (p_org IS NULL OR r.organization_id=p_org)
  )
  SELECT r.*,v.definition,v.published_by FROM crm_automation_runs r JOIN eligible eligible_job ON eligible_job.id=r.id AND eligible_job.tenant_position<=10 JOIN crm_automations a ON a.id=r.automation_id JOIN crm_automation_versions v ON v.id=r.version_id
  WHERE r.status IN ('pending','waiting','retrying') AND r.available_at<=now() AND a.status='published' AND (p_org IS NULL OR r.organization_id=p_org)
  ORDER BY r.available_at,r.id LIMIT least(greatest(p_limit,1),100) FOR UPDATE OF r SKIP LOCKED
 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('automation-worker:'||job.organization_id,0)) THEN CONTINUE;END IF;
  -- A configuration lock prevents pause/archive racing a committed action.
  PERFORM 1 FROM crm_automations WHERE id=job.automation_id AND status='published' FOR SHARE;
  IF NOT FOUND THEN CONTINUE;END IF;
  BEGIN
   PERFORM 1 FROM organization_members m JOIN profiles p ON p.id=m.user_id JOIN organizations org ON org.id=m.organization_id WHERE m.id=job.published_by AND m.organization_id=job.organization_id AND m.is_active AND m.deleted_at IS NULL AND m.role IN ('owner','administrator') AND p.is_active AND p.auth_deleted_at IS NULL AND org.deleted_at IS NULL FOR SHARE OF m,p,org;
   IF NOT FOUND THEN RAISE EXCEPTION 'Execution identity no longer authorized' USING ERRCODE='42501';END IF;
   SELECT * INTO STRICT e FROM crm_automation_events WHERE id=job.event_id AND organization_id=job.organization_id;
   live:=NULL;
   CASE e.entity
    WHEN 'lead' THEN SELECT to_jsonb(x) INTO live FROM leads x WHERE id=e.record_id AND organization_id=job.organization_id AND deleted_at IS NULL FOR UPDATE;
    WHEN 'deal' THEN SELECT to_jsonb(x) INTO live FROM deals x WHERE id=e.record_id AND organization_id=job.organization_id AND deleted_at IS NULL FOR UPDATE;
    WHEN 'company' THEN SELECT to_jsonb(x) INTO live FROM companies x WHERE id=e.record_id AND organization_id=job.organization_id AND deleted_at IS NULL FOR UPDATE;
    WHEN 'contact' THEN SELECT to_jsonb(x) INTO live FROM contacts x WHERE id=e.record_id AND organization_id=job.organization_id AND deleted_at IS NULL FOR UPDATE;
    WHEN 'activity' THEN SELECT to_jsonb(x) INTO live FROM crm_activities x WHERE id=e.record_id AND organization_id=job.organization_id FOR UPDATE;
    ELSE RAISE EXCEPTION 'Unsupported record' USING ERRCODE='22023';
   END CASE;
   IF live IS NULL THEN RAISE EXCEPTION 'Trigger record unavailable' USING ERRCODE='P0002';END IF;
   IF job.cursor=0 AND e.trigger IN ('company.inactive','company.action_overdue') AND NOT EXISTS(
    SELECT 1 FROM crm_automation_account_timers timer WHERE timer.organization_id=job.organization_id AND timer.company_id=e.record_id
    AND timer.kind=split_part(e.trigger,'.',2) AND timer.item_id=(e.snapshot->>'timerItemId')::uuid
    AND timer.anchor_at=(e.snapshot->>'timerAnchor')::timestamptz AND timer.anchor_at<=now()-make_interval(mins=>coalesce((job.definition->>'scheduleMinutes')::integer,1440))
   ) THEN UPDATE crm_automation_runs SET status='skipped',completed_at=now() WHERE id=job.id;count_done:=count_done+1;CONTINUE;END IF;
   -- A timer can become obsolete while queued or delayed. Check current state.
   IF job.cursor=0 AND (e.trigger='activity.overdue' AND (live->>'completed_at' IS NOT NULL OR live->>'due_at' IS NULL OR (live->>'due_at')::timestamptz>now()-make_interval(mins=>coalesce((job.definition->>'scheduleMinutes')::integer,1440)))
    OR e.trigger='lead.no_response' AND (live->>'status'<>'new' OR live->>'converted_at' IS NOT NULL)
    OR e.trigger IN ('lead.no_response','deal.stalled') AND (live->>'updated_at')::timestamptz>now()-make_interval(mins=>coalesce((job.definition->>'scheduleMinutes')::integer,1440))
    OR e.trigger='deal.closing_soon' AND (live->>'expected_close' IS NULL OR (live->>'expected_close')::date<current_date OR (live->>'expected_close')::date>current_date+make_interval(mins=>coalesce((job.definition->>'scheduleMinutes')::integer,1440)))
    OR e.trigger IN ('deal.stalled','deal.closing_soon') AND live->>'stage' IN ('closed_won','closed_lost')) THEN
    UPDATE crm_automation_runs SET status='skipped',completed_at=now() WHERE id=job.id;count_done:=count_done+1;CONTINUE;
   END IF;
   IF job.matched IS NULL THEN
    job.matched:=crm_automation_matches(job.definition->'conditions',e.snapshot);
    UPDATE crm_automation_runs SET condition_results=crm_automation_explain(job.definition->'conditions',e.snapshot) WHERE id=job.id;
   END IF;
   UPDATE crm_automation_runs SET started_at=coalesce(started_at,now()),matched=job.matched WHERE id=job.id;
   IF NOT job.matched AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(job.definition->'steps') x WHERE x->>'branch'='unmatched') THEN
    UPDATE crm_automation_runs SET status='skipped',completed_at=now() WHERE id=job.id;count_done:=count_done+1;CONTINUE;
   END IF;
   s:=job.definition->'steps'->job.cursor;affected:=NULL;outcome:='succeeded';
   IF s IS NULL THEN UPDATE crm_automation_runs SET status='succeeded',completed_at=now() WHERE id=job.id;CONTINUE;END IF;
   PERFORM set_config('nextmav.automation_run',job.id::text,true);
   IF s->>'branch'='matched' AND NOT job.matched OR s->>'branch'='unmatched' AND job.matched THEN outcome:='skipped';
   ELSE
    recipient:=coalesce(nullif(s->>'memberId','')::uuid,nullif(live->>'owner_id','')::uuid,nullif(live->>'member_id','')::uuid,job.published_by);
    IF s->>'type' IN ('assign_owner','create_task','create_account_action','notify') AND NOT EXISTS(SELECT 1 FROM organization_members WHERE id=recipient AND organization_id=job.organization_id AND is_active AND deleted_at IS NULL AND role IN ('owner','administrator','manager','sales_staff')) THEN RAISE EXCEPTION 'Recipient unavailable' USING ERRCODE='42501';END IF;
    CASE s->>'type'
     WHEN 'assign_lead','reassign_lead' THEN
      live:=crm_assign_lead_internal(job.organization_id,e.record_id,md5(job.id::text||(s->>'id'))::uuid,s->>'type'='reassign_lead');
      IF live->>'ownerId' IS NULL THEN RAISE EXCEPTION 'Configure lead assignment rules or fallback' USING ERRCODE='22023';END IF;
      affected:=live->>'ownerId';
     WHEN 'assign_owner' THEN
      IF e.entity='deal' THEN UPDATE deals SET owner_id=recipient WHERE id=e.record_id AND organization_id=job.organization_id;
      ELSIF e.entity='company' THEN UPDATE companies SET owner_id=recipient WHERE id=e.record_id AND organization_id=job.organization_id;
      ELSE RAISE EXCEPTION 'Unsupported owner assignment' USING ERRCODE='22023';END IF;affected:=recipient::text;
     WHEN 'create_account_action' THEN
      SELECT to_jsonb(p) INTO plan_data FROM crm_account_plans p WHERE company_id=e.record_id AND organization_id=job.organization_id;
      plan_data:=coalesce(plan_data,'{}'::jsonb);
      SELECT user_id INTO publisher_user FROM organization_members WHERE id=job.published_by AND organization_id=job.organization_id;
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',publisher_user,'role','authenticated')::text,true);
      PERFORM crm_save_account_plan(job.organization_id,e.record_id,coalesce((plan_data->>'version')::integer,0),plan_data||jsonb_build_object('ownerId',plan_data->'owner_id','reviewDate',plan_data->'review_date','items',coalesce(plan_data->'items','[]')||jsonb_build_array(jsonb_build_object('id',md5(job.id::text||(s->>'id'))::uuid,'kind','action','title',s->>'text','description','','status','planned','priority','normal','progress',0,'ownerId',recipient,'contactId',null,'dealId',null,'dueDate',(now()+make_interval(mins=>(s->>'minutes')::integer))::date,'role','','influence',''))));
      PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);affected:=md5(job.id::text||(s->>'id'));
     WHEN 'add_tag' THEN
      IF e.entity='company' THEN
       UPDATE companies SET crm_profile=jsonb_set(crm_profile,'{tags}',coalesce(crm_profile->'tags','[]')||jsonb_build_array(btrim(s->>'text'))) WHERE id=e.record_id AND organization_id=job.organization_id AND NOT coalesce(crm_profile->'tags','[]') ? btrim(s->>'text');
      ELSIF e.entity='contact' THEN
       UPDATE contacts SET crm_profile=jsonb_set(crm_profile,'{tags}',coalesce(crm_profile->'tags','[]')||jsonb_build_array(btrim(s->>'text'))) WHERE id=e.record_id AND organization_id=job.organization_id AND NOT coalesce(crm_profile->'tags','[]') ? btrim(s->>'text');
      ELSE RAISE EXCEPTION 'Tags require account or contact' USING ERRCODE='22023';END IF;affected:=e.record_id::text;
     WHEN 'update_lead_status' THEN
      IF live->>'converted_at' IS NOT NULL THEN RAISE EXCEPTION 'Converted lead cannot be updated by automation' USING ERRCODE='22023';END IF;
      UPDATE leads SET status=(s->>'text')::lead_status WHERE id=e.record_id AND organization_id=job.organization_id;affected:=e.record_id::text;
     WHEN 'update_next_step' THEN UPDATE deals SET next_step=s->>'text' WHERE id=e.record_id AND organization_id=job.organization_id;affected:=e.record_id::text;
     WHEN 'create_task' THEN
      INSERT INTO crm_activities(organization_id,activity_type,subject,member_id,due_at,lead_id,deal_id,company_id,contact_id)
      VALUES(job.organization_id,'followup',s->>'text',recipient,now()+make_interval(mins=>(s->>'minutes')::integer),
       CASE WHEN e.entity='lead' THEN e.record_id WHEN e.entity='activity' THEN (live->>'lead_id')::uuid END,
       CASE WHEN e.entity='deal' THEN e.record_id WHEN e.entity='activity' THEN (live->>'deal_id')::uuid END,
       CASE WHEN e.entity='company' THEN e.record_id WHEN e.entity='activity' THEN (live->>'company_id')::uuid END,
       CASE WHEN e.entity='contact' THEN e.record_id WHEN e.entity='activity' THEN (live->>'contact_id')::uuid END) RETURNING id::text INTO affected;
     WHEN 'notify' THEN INSERT INTO notifications(organization_id,recipient_id,type,title,body,entity_type,entity_id)
      VALUES(job.organization_id,recipient,'crm_automation',s->>'text','Created by Automation Studio',CASE WHEN e.entity='activity' THEN 'crm_activity' ELSE e.entity END,e.record_id) RETURNING id::text INTO affected;
     WHEN 'wait' THEN outcome:='waiting';
     WHEN 'check' THEN job.matched:=crm_automation_matches(job.definition->'conditions',live);outcome:=CASE WHEN job.matched THEN 'matched' ELSE 'unmatched' END;
      UPDATE crm_automation_runs SET condition_results=crm_automation_explain(job.definition->'conditions',live) WHERE id=job.id;
     ELSE RAISE EXCEPTION 'Unsupported action' USING ERRCODE='22023';
    END CASE;
   END IF;
   INSERT INTO crm_automation_steps(organization_id,run_id,position,action,outcome,affected_id) VALUES(job.organization_id,job.id,job.cursor,s->>'type',outcome,affected);
   UPDATE crm_automation_runs SET cursor=cursor+1,matched=job.matched,attempts=0,error_code=NULL,error_action=NULL,
    status=CASE WHEN outcome='waiting' THEN 'waiting' WHEN job.cursor+1>=jsonb_array_length(job.definition->'steps') THEN 'succeeded' ELSE 'pending' END,
    available_at=CASE WHEN outcome='waiting' THEN now()+make_interval(mins=>(s->>'minutes')::integer) ELSE now() END,
    completed_at=CASE WHEN outcome<>'waiting' AND job.cursor+1>=jsonb_array_length(job.definition->'steps') THEN now() END WHERE id=job.id;
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
   UPDATE crm_automation_runs SET attempts=attempts+1,error_code=code,error_action=job.definition->'steps'->job.cursor->>'type',
    status=CASE WHEN code IN ('40001','40P01','55P03','57014','53300') AND attempts<4 THEN 'retrying' ELSE 'failed' END,
    available_at=now()+make_interval(secs=>least(3600,30*power(2,job.attempts)::integer)),
    completed_at=CASE WHEN code NOT IN ('40001','40P01','55P03','57014','53300') OR attempts>=4 THEN now() END WHERE id=job.id;
   -- One alert per workflow per hour, no record values or raw SQL errors.
   UPDATE crm_automations SET last_alert_at=now() WHERE id=job.automation_id AND (last_alert_at IS NULL OR last_alert_at<now()-interval '1 hour');
   IF FOUND THEN INSERT INTO notifications(organization_id,recipient_id,type,title,body) VALUES(job.organization_id,job.published_by,'crm_automation','Automation needs attention','Review execution history in CRM Automation Studio.');END IF;
  END;
  PERFORM set_config('nextmav.automation_run',coalesce(previous_cause,''),true);
  count_done:=count_done+1;
 END LOOP;
 RETURN count_done;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_worker(integer,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.crm_automation_retry(p_org uuid,p_run uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r crm_automation_runs%ROWTYPE;
BEGIN
 IF NOT public.crm_automation_admin(p_org) THEN RAISE EXCEPTION 'Retry not permitted' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM crm_automation_runs WHERE id=p_run AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND OR r.status<>'failed' OR r.retry_count>=3 THEN RAISE EXCEPTION 'Run is not eligible for retry' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM crm_automations WHERE id=r.automation_id AND status='published') THEN RAISE EXCEPTION 'Resume the automation before retrying' USING ERRCODE='22023';END IF;
 UPDATE crm_automation_runs SET status='pending',attempts=0,retry_count=retry_count+1,available_at=now(),completed_at=NULL,error_code=NULL WHERE id=r.id;
 INSERT INTO crm_automation_audit(organization_id,automation_id,actor_id,operation,revision) SELECT p_org,r.automation_id,public.auth_member_id(p_org),'retry:'||r.id,revision FROM crm_automations WHERE id=r.automation_id;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_retry(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_automation_retry(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_automation_run_metrics() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN UPDATE crm_automations SET execution_count=execution_count+1,last_run_at=NEW.created_at,last_outcome=NEW.status WHERE id=NEW.automation_id;
 ELSIF NEW.status IS DISTINCT FROM OLD.status THEN UPDATE crm_automations SET last_outcome=NEW.status WHERE id=NEW.automation_id AND last_run_at=NEW.created_at;END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_run_metrics() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_automation_run_metrics ON crm_automation_runs;
CREATE TRIGGER crm_automation_run_metrics AFTER INSERT OR UPDATE ON crm_automation_runs FOR EACH ROW EXECUTE FUNCTION public.crm_automation_run_metrics();

CREATE OR REPLACE FUNCTION public.crm_automation_health(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE active boolean:=false; last_run timestamptz; last_status text;
BEGIN
 IF NOT crm_automation_admin(p_org) THEN RAISE EXCEPTION 'Not permitted' USING ERRCODE='42501';END IF;
 IF to_regclass('cron.job') IS NOT NULL THEN
  SELECT j.active INTO active FROM cron.job j WHERE jobname='crm-automation-worker';
  SELECT d.end_time,d.status INTO last_run,last_status FROM cron.job_run_details d JOIN cron.job j USING(jobid) WHERE j.jobname='crm-automation-worker' ORDER BY d.runid DESC LIMIT 1;
 END IF;
 RETURN jsonb_build_object('active',coalesce(active,false),'lastRun',last_run,'lastStatus',last_status);
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_health(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_automation_health(uuid) TO authenticated;

-- Keep 90 days of completed execution detail, preserving cumulative counts and
-- immutable versions. Pending, delayed, retrying and failed work is never purged.
CREATE OR REPLACE FUNCTION public.crm_automation_retention() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids uuid[]; n integer;
BEGIN
 SELECT array_agg(id) INTO ids FROM (SELECT id FROM crm_automation_runs WHERE status IN ('succeeded','skipped','cancelled') AND completed_at<now()-interval '90 days' ORDER BY completed_at LIMIT 1000 FOR UPDATE SKIP LOCKED) old_runs;
 DELETE FROM crm_automation_steps WHERE run_id=ANY(ids);
 DELETE FROM crm_automation_runs WHERE id=ANY(ids);GET DIAGNOSTICS n=ROW_COUNT;
 DELETE FROM crm_automation_events WHERE id IN (SELECT e.id FROM crm_automation_events e WHERE created_at<now()-interval '90 days' AND trigger NOT IN ('lead.no_response','deal.stalled','deal.closing_soon','activity.overdue','company.inactive','company.action_overdue') AND NOT EXISTS(SELECT 1 FROM crm_automation_runs r WHERE r.event_id=e.id) ORDER BY created_at LIMIT 1000);
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_retention() FROM PUBLIC,anon,authenticated;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='crm-automation-worker') THEN
   PERFORM cron.schedule('crm-automation-worker','* * * * *','SELECT public.crm_automation_worker(100)');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='crm-automation-retention') THEN PERFORM cron.schedule('crm-automation-retention','17 * * * *','SELECT public.crm_automation_retention()');END IF;
 ELSE RAISE NOTICE 'Automation scheduler unavailable. Install pg_cron and schedule crm_automation_worker(100). Do not publish until configured.';END IF;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_automations','crm_automation_runs','crm_automation_steps'] LOOP
  EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL',t);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);END IF;
 END LOOP;
END $$;
