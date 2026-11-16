-- Focused manual outreach sequences. Execution is delegated to Automation Studio.
-- Email steps deliberately remain unavailable until authorized provider sends exist.
CREATE TABLE IF NOT EXISTS crm_sales_sequences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 automation_id uuid NOT NULL UNIQUE REFERENCES crm_automations(id), owner_id uuid NOT NULL REFERENCES organization_members(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), audience text NOT NULL CHECK(audience IN ('lead','contact')),
 definition jsonb NOT NULL, revision integer NOT NULL DEFAULT 1, archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS crm_sales_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 sequence_id uuid NOT NULL, record_type text NOT NULL CHECK(record_type IN ('lead','contact')), record_id uuid NOT NULL,
 owner_id uuid NOT NULL REFERENCES organization_members(id), run_id uuid NOT NULL UNIQUE REFERENCES crm_automation_runs(id),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused','completed','stopped','opted_out','replied','failed')),
 lawful_basis text NOT NULL CHECK(length(btrim(lawful_basis)) BETWEEN 10 AND 1000),
 stopped_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,sequence_id) REFERENCES crm_sales_sequences(organization_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_sales_one_active_enrollment ON crm_sales_enrollments(organization_id,record_type,record_id) WHERE state IN ('active','paused');
CREATE INDEX IF NOT EXISTS crm_sales_enrollment_owner ON crm_sales_enrollments(organization_id,owner_id,created_at DESC);
ALTER TABLE crm_sales_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sales_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_sales_sequences,crm_sales_enrollments FROM anon,authenticated;
GRANT SELECT ON crm_sales_sequences,crm_sales_enrollments TO authenticated;
DROP POLICY IF EXISTS sales_sequences_read ON crm_sales_sequences;
CREATE POLICY sales_sequences_read ON crm_sales_sequences FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm'));
DROP POLICY IF EXISTS sales_enrollments_read ON crm_sales_enrollments;
CREATE POLICY sales_enrollments_read ON crm_sales_enrollments FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm') AND (owner_id=auth_member_id(organization_id) OR crm_automation_admin(organization_id)) AND
 (record_type='lead' AND EXISTS(SELECT 1 FROM leads WHERE id=record_id AND organization_id=crm_sales_enrollments.organization_id AND deleted_at IS NULL AND crm_record_visible(organization_id,owner_id)) OR record_type='contact' AND EXISTS(SELECT 1 FROM contacts WHERE id=record_id AND organization_id=crm_sales_enrollments.organization_id AND deleted_at IS NULL)));

CREATE OR REPLACE FUNCTION public.crm_sales_sequence_save(p_org uuid,p_name text,p_audience text,p_steps jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE aid uuid:=gen_random_uuid(); vid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); definition jsonb; step jsonb;
BEGIN
 IF NOT crm_automation_admin(p_org) THEN RAISE EXCEPTION 'Administrator required to publish sequences' USING ERRCODE='42501'; END IF;
 IF p_audience NOT IN ('lead','contact') OR jsonb_typeof(p_steps) IS DISTINCT FROM 'array' OR jsonb_array_length(p_steps) NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Choose an audience and 1 to 12 steps' USING ERRCODE='22023'; END IF;
 FOR step IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
  IF step->>'type' IS NULL OR step->>'type' NOT IN ('wait','call','followup') OR (step->>'minutes') IS NULL OR (step->>'minutes')::integer NOT BETWEEN 1 AND 43200 OR (step->>'type'<>'wait' AND length(btrim(coalesce(step->>'text',''))) NOT BETWEEN 1 AND 250) THEN RAISE EXCEPTION 'Only bounded waits, manual calls and follow-ups are supported' USING ERRCODE='22023'; END IF;
 END LOOP;
 SELECT jsonb_build_object('trigger','sales.sequence_enrolled','conditions',jsonb_build_object('mode','all','groups','[]'::jsonb),'steps',jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'type',CASE WHEN value->>'type'='wait' THEN 'wait' ELSE 'create_task' END,'text',CASE WHEN value->>'type'='call' THEN 'Call: ' ELSE '' END||coalesce(value->>'text',''),'minutes',(value->>'minutes')::integer,'memberId','','branch','always') ORDER BY ordinal)) INTO definition FROM jsonb_array_elements(p_steps) WITH ORDINALITY x(value,ordinal);
 INSERT INTO crm_automations(id,organization_id,owner_id,name,description,status,draft) VALUES(aid,p_org,auth_member_id(p_org),p_name,'Managed by Sales Engagement. Manual outreach only.','published',definition);
 INSERT INTO crm_automation_versions(id,organization_id,automation_id,definition,published_by) VALUES(vid,p_org,aid,definition,auth_member_id(p_org));
 UPDATE crm_automations SET published_version=vid WHERE id=aid;
 INSERT INTO crm_sales_sequences(id,organization_id,automation_id,owner_id,name,audience,definition) VALUES(sid,p_org,aid,auth_member_id(p_org),p_name,p_audience,p_steps);
 INSERT INTO crm_automation_audit(organization_id,automation_id,actor_id,operation,revision) VALUES(p_org,aid,auth_member_id(p_org),'sales_sequence_publish',1);
 RETURN sid;
END $$;

CREATE OR REPLACE FUNCTION public.crm_sales_recipient_eligible(p_org uuid,p_type text,p_record uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_type='lead' THEN EXISTS(SELECT 1 FROM leads l WHERE l.id=p_record AND l.organization_id=p_org AND l.deleted_at IS NULL AND l.converted_at IS NULL AND l.status::text NOT IN ('won','lost') AND NOT coalesce((l.communication_preferences->>'doNotContact')::boolean,false) AND coalesce(l.communication_preferences->>'phone','unknown')<>'withdrawn' AND coalesce(l.communication_preferences->>'email','unknown')<>'withdrawn')
 WHEN p_type='contact' THEN EXISTS(SELECT 1 FROM contacts c WHERE c.id=p_record AND c.organization_id=p_org AND c.deleted_at IS NULL AND c.is_active AND NOT coalesce((c.crm_profile->>'emailOptOut')::boolean,false) AND NOT coalesce((c.crm_profile->>'phoneOptOut')::boolean,false)) ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.crm_sales_sequence_enroll(p_org uuid,p_sequence uuid,p_record uuid,p_basis text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s crm_sales_sequences%ROWTYPE; eid uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid(); enrollment uuid:=gen_random_uuid(); aid uuid; target_owner uuid;
BEGIN
 IF NOT can_access_module(p_org,'crm') OR auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'CRM write permission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM crm_sales_sequences WHERE id=p_sequence AND organization_id=p_org AND NOT archived FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sequence unavailable' USING ERRCODE='42501'; END IF;
 IF s.audience='lead' THEN SELECT owner_id INTO target_owner FROM leads WHERE id=p_record AND organization_id=p_org AND deleted_at IS NULL AND crm_record_visible(organization_id,owner_id) FOR UPDATE;
 ELSE SELECT owner_id INTO target_owner FROM contacts WHERE id=p_record AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE; END IF;
 IF NOT FOUND OR NOT crm_sales_recipient_eligible(p_org,s.audience,p_record) THEN RAISE EXCEPTION 'Recipient is unavailable or has opted out' USING ERRCODE='42501'; END IF;
 IF target_owner IS DISTINCT FROM auth_member_id(p_org) AND NOT crm_automation_admin(p_org) THEN RAISE EXCEPTION 'Only the record owner or administrator can enroll' USING ERRCODE='42501'; END IF;
 SELECT published_version INTO aid FROM crm_automations WHERE id=s.automation_id AND organization_id=p_org AND status='published' FOR SHARE;
 IF aid IS NULL THEN RAISE EXCEPTION 'Sequence is not published' USING ERRCODE='22023'; END IF;
 INSERT INTO crm_automation_events(id,organization_id,trigger,entity,record_id,snapshot) VALUES(eid,p_org,'sales.sequence_enrolled',s.audience,p_record,jsonb_build_object('owner_id',auth_member_id(p_org)));
 INSERT INTO crm_automation_runs(id,organization_id,automation_id,version_id,event_id) VALUES(rid,p_org,s.automation_id,aid,eid);
 INSERT INTO crm_sales_enrollments(id,organization_id,sequence_id,record_type,record_id,owner_id,run_id,lawful_basis) VALUES(enrollment,p_org,s.id,s.audience,p_record,auth_member_id(p_org),rid,p_basis);
 RETURN enrollment;
END $$;

CREATE OR REPLACE FUNCTION public.crm_sales_enrollment_action(p_org uuid,p_id uuid,p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e crm_sales_enrollments%ROWTYPE; r crm_automation_runs%ROWTYPE;
BEGIN
 IF NOT can_access_module(p_org,'crm') OR auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'CRM write permission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM crm_sales_enrollments WHERE id=p_id AND organization_id=p_org;
 IF NOT FOUND OR (e.owner_id<>auth_member_id(p_org) AND NOT crm_automation_admin(p_org)) THEN RAISE EXCEPTION 'Enrollment unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM crm_automation_runs WHERE id=e.run_id FOR UPDATE;
 SELECT * INTO e FROM crm_sales_enrollments WHERE id=p_id FOR UPDATE;
 IF p_action='resume' AND e.state='paused' THEN
  IF NOT crm_sales_recipient_eligible(p_org,e.record_type,e.record_id) THEN RAISE EXCEPTION 'Recipient is suppressed' USING ERRCODE='42501'; END IF;
  UPDATE crm_sales_enrollments SET state='active',updated_at=now() WHERE id=e.id;
  UPDATE crm_automation_runs SET status='pending',completed_at=NULL WHERE id=e.run_id;
 ELSIF p_action IN ('pause','stop','opt_out') AND e.state IN ('active','paused') THEN
  UPDATE crm_sales_enrollments SET state=CASE p_action WHEN 'pause' THEN 'paused' WHEN 'opt_out' THEN 'opted_out' ELSE 'stopped' END,stopped_reason=p_action,updated_at=now() WHERE id=e.id;
  UPDATE crm_automation_runs SET status='cancelled',completed_at=now() WHERE id=e.run_id;
  IF p_action='opt_out' THEN
   IF e.record_type='lead' THEN UPDATE leads SET communication_preferences=communication_preferences||'{"doNotContact":true}'::jsonb WHERE id=e.record_id AND organization_id=p_org;
   ELSE UPDATE contacts SET crm_profile=crm_profile||'{"emailOptOut":true,"phoneOptOut":true}'::jsonb WHERE id=e.record_id AND organization_id=p_org; END IF;
  END IF;
 ELSE RAISE EXCEPTION 'Enrollment cannot make that transition' USING ERRCODE='PT409'; END IF;
END $$;

-- The existing worker locks the run before creating an activity. The guard runs
-- in that same transaction, so a stopped/suppressed recipient cannot get a new task.
CREATE OR REPLACE FUNCTION public.crm_sales_sequence_task_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e crm_sales_enrollments%ROWTYPE; run uuid:=nullif(current_setting('nextmav.automation_run',true),'')::uuid;
BEGIN
 IF run IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO e FROM crm_sales_enrollments WHERE run_id=run;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF e.state<>'active' OR NOT crm_sales_recipient_eligible(e.organization_id,e.record_type,e.record_id) THEN RAISE EXCEPTION 'Sales recipient suppressed or enrollment stopped' USING ERRCODE='42501'; END IF;
 IF e.record_type='lead' AND NOT EXISTS(SELECT 1 FROM leads WHERE id=e.record_id AND organization_id=e.organization_id AND (owner_id=e.owner_id OR EXISTS(SELECT 1 FROM organization_members WHERE id=e.owner_id AND role IN ('owner','administrator')))) THEN RAISE EXCEPTION 'Sequence owner no longer has record access' USING ERRCODE='42501'; END IF;
 NEW.member_id:=e.owner_id;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_sales_sequence_task_guard ON crm_activities;
CREATE TRIGGER crm_sales_sequence_task_guard BEFORE INSERT ON crm_activities FOR EACH ROW EXECUTE FUNCTION public.crm_sales_sequence_task_guard();

CREATE OR REPLACE FUNCTION public.crm_sales_sequence_run_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status IN ('succeeded','failed') THEN UPDATE crm_sales_enrollments SET state=CASE WHEN NEW.status='succeeded' THEN 'completed' WHEN NOT crm_sales_recipient_eligible(organization_id,record_type,record_id) THEN 'opted_out' ELSE 'failed' END,updated_at=now() WHERE run_id=NEW.id AND state='active'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_sales_sequence_run_state ON crm_automation_runs;
CREATE TRIGGER crm_sales_sequence_run_state AFTER UPDATE OF status ON crm_automation_runs FOR EACH ROW EXECUTE FUNCTION public.crm_sales_sequence_run_state();

REVOKE ALL ON FUNCTION public.crm_sales_sequence_save(uuid,text,text,jsonb),public.crm_sales_sequence_enroll(uuid,uuid,uuid,text),public.crm_sales_enrollment_action(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_sales_sequence_save(uuid,text,text,jsonb),public.crm_sales_sequence_enroll(uuid,uuid,uuid,text),public.crm_sales_enrollment_action(uuid,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.crm_sales_recipient_eligible(uuid,text,uuid),public.crm_sales_sequence_task_guard(),public.crm_sales_sequence_run_state() FROM PUBLIC,anon,authenticated;
