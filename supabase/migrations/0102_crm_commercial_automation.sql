-- Extend the existing durable worker. No second runner or scheduling engine.
DO $$ DECLARE definition text; before_definition text; BEGIN
 SELECT pg_get_functiondef('crm_automation_validate(jsonb)'::regprocedure) INTO definition;
 before_definition:=definition;
 IF position('commercial.quote_submitted' in definition)=0 THEN
 definition:=replace(definition,'''activity.overdue'')','''activity.overdue'',''commercial.quote_submitted'',''commercial.quote_approved'',''commercial.quote_rejected'',''commercial.proposal_approved'',''commercial.contract_executed'')');
 definition:=replace(definition,'WHEN ''activity'' THEN f IN (''due_at'',''completed_at'')','WHEN ''commercial'' THEN f IN (''status'',''value'',''currency'',''owner_id'') WHEN ''activity'' THEN f IN (''due_at'',''completed_at'')');
 IF definition=before_definition THEN RAISE EXCEPTION 'Automation validator extension anchor missing';END IF;
 EXECUTE definition;
 END IF;
 SELECT pg_get_functiondef('crm_automation_worker(integer,uuid)'::regprocedure) INTO definition;
 before_definition:=definition;
 IF position('WHEN ''commercial'' THEN SELECT' in definition)=0 THEN
 definition:=replace(definition,'CASE e.entity','CASE e.entity');
 definition:=replace(definition,'WHEN ''lead'' THEN SELECT to_jsonb(x) INTO live', 'WHEN ''commercial'' THEN SELECT to_jsonb(x)||jsonb_build_object(''value'',x.total) INTO live FROM crm_commercial_records x WHERE id=e.record_id AND organization_id=job.organization_id FOR UPDATE; WHEN ''lead'' THEN SELECT to_jsonb(x) INTO live');
 definition:=replace(definition,'WHEN e.entity=''activity'' THEN (live->>','WHEN e.entity IN (''activity'',''commercial'') THEN (live->>');
 IF definition=before_definition THEN RAISE EXCEPTION 'Automation worker extension anchor missing';END IF;
 EXECUTE definition;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.crm_commercial_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event_name text;
BEGIN
 IF NEW.status=OLD.status THEN RETURN NEW;END IF;
 event_name:=CASE WHEN NEW.kind='quote' AND NEW.status='pending_approval' THEN 'commercial.quote_submitted'
 WHEN NEW.kind='quote' AND NEW.status='approved' THEN 'commercial.quote_approved'
 WHEN NEW.kind='quote' AND NEW.status='rejected' THEN 'commercial.quote_rejected'
 WHEN NEW.kind='proposal' AND NEW.status='approved' THEN 'commercial.proposal_approved'
 WHEN NEW.kind='contract' AND NEW.status='executed' THEN 'commercial.contract_executed' END;
 IF event_name IS NOT NULL THEN PERFORM crm_automation_emit(NEW.organization_id,event_name,'commercial',NEW.id,to_jsonb(NEW)||jsonb_build_object('value',NEW.total));END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_commercial_capture() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS commercial_automation ON crm_commercial_records;
CREATE TRIGGER commercial_automation AFTER UPDATE OF status ON crm_commercial_records FOR EACH ROW EXECUTE FUNCTION public.crm_commercial_capture();

CREATE TABLE IF NOT EXISTS crm_commercial_reminders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,record_id uuid NOT NULL,expires_on date NOT NULL,days_before integer NOT NULL CHECK(days_before BETWEEN 0 AND 3650),
 activity_id uuid NOT NULL REFERENCES crm_activities(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_commercial_records(organization_id,id),UNIQUE(record_id,expires_on,days_before)
);
ALTER TABLE crm_commercial_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_commercial_reminders FROM anon,authenticated;
GRANT SELECT ON crm_commercial_reminders TO authenticated;
DROP POLICY IF EXISTS commercial_read ON crm_commercial_reminders;
CREATE POLICY commercial_read ON crm_commercial_reminders FOR SELECT TO authenticated USING(crm_commercial_visible(organization_id,record_id));
CREATE OR REPLACE FUNCTION public.crm_commercial_remind(p_org uuid,p_record uuid,p_revision integer,p_days integer[]) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r crm_commercial_records%ROWTYPE; offset_days integer; aid uuid; count_added integer:=0;
BEGIN
 IF auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') OR NOT crm_commercial_visible(p_org,p_record) THEN RAISE EXCEPTION 'Reminder configuration not permitted' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM crm_commercial_records WHERE id=p_record AND organization_id=p_org FOR UPDATE;
 IF r.revision<>p_revision THEN RAISE EXCEPTION 'Stale revision' USING ERRCODE='PT409';END IF;
 IF r.kind NOT IN ('contract','renewal') OR r.expires_on IS NULL OR cardinality(p_days) NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'An expiration date and 1–12 reminder offsets are required' USING ERRCODE='22023';END IF;
 FOREACH offset_days IN ARRAY p_days LOOP
  IF offset_days IS NULL OR offset_days NOT BETWEEN 0 AND 3650 THEN RAISE EXCEPTION 'Invalid reminder offset' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM crm_commercial_reminders WHERE record_id=p_record AND expires_on=r.expires_on AND days_before=offset_days) THEN CONTINUE;END IF;
  INSERT INTO crm_activities(organization_id,company_id,deal_id,contact_id,member_id,activity_type,subject,body,due_at)
   VALUES(p_org,r.company_id,r.deal_id,r.contact_id,r.owner_id,'followup','Renewal review: '||r.number,'Explicit commercial reminder; review the agreement and its notice requirements.',(r.expires_on-offset_days)::timestamptz) RETURNING id INTO aid;
  INSERT INTO crm_commercial_reminders(organization_id,record_id,expires_on,days_before,activity_id) VALUES(p_org,p_record,r.expires_on,offset_days,aid);count_added:=count_added+1;
 END LOOP;
 IF count_added>0 THEN INSERT INTO crm_commercial_history(organization_id,record_id,revision,operation,note,actor_id) VALUES(p_org,p_record,r.revision,'reminders_configured',array_to_string(p_days,',')||' days before expiration',auth_member_id(p_org));END IF;
 RETURN count_added;
END $$;
REVOKE ALL ON FUNCTION public.crm_commercial_remind(uuid,uuid,integer,integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_commercial_remind(uuid,uuid,integer,integer[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_commercial_snapshot_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 NEW.snapshot:=NEW.snapshot||jsonb_build_object('customerName',(SELECT name FROM companies WHERE id=(NEW.snapshot->>'company_id')::uuid AND organization_id=NEW.organization_id),'organizationName',(SELECT name FROM organizations WHERE id=NEW.organization_id));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_commercial_snapshot_identity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS commercial_snapshot_identity ON crm_commercial_versions;
CREATE TRIGGER commercial_snapshot_identity BEFORE INSERT ON crm_commercial_versions FOR EACH ROW EXECUTE FUNCTION public.crm_commercial_snapshot_identity();
