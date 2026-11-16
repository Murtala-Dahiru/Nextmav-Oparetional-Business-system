-- Configurable stages map to existing deal_stage outcomes so legacy reports,
-- integrations and closure/history triggers retain their established contract.
CREATE TABLE IF NOT EXISTS crm_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
  purpose text NOT NULL DEFAULT 'new_business' CHECK(purpose IN ('new_business','enterprise','renewals','partnerships','expansion')),
  version integer NOT NULL DEFAULT 1, archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_pipelines_org ON crm_pipelines(organization_id);
CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
  pipeline_id uuid NOT NULL REFERENCES crm_pipelines(id),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
  position integer NOT NULL CHECK(position>=0),canonical_stage deal_stage NOT NULL,
  probability integer NOT NULL CHECK(probability BETWEEN 0 AND 100),
  entry_guidance text NOT NULL DEFAULT '' CHECK(length(entry_guidance)<=4000),
  exit_guidance text NOT NULL DEFAULT '' CHECK(length(exit_guidance)<=4000),
  required_fields text[] NOT NULL DEFAULT '{}',exit_required_fields text[] NOT NULL DEFAULT '{}',
  allowed_next uuid[] NOT NULL DEFAULT '{}',owner_id uuid REFERENCES organization_members(id),
  inactivity_days integer NOT NULL DEFAULT 30 CHECK(inactivity_days BETWEEN 1 AND 3650),
  requires_approval boolean NOT NULL DEFAULT false,archived boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_crm_stages_pipeline ON crm_pipeline_stages(organization_id,pipeline_id,position);
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES crm_pipelines(id);
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS pipeline_stage_id uuid REFERENCES crm_pipeline_stages(id);
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS pipeline_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS next_step text NOT NULL DEFAULT '';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS forecast_category text NOT NULL DEFAULT 'pipeline';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS competitor text NOT NULL DEFAULT '';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS outcome_notes text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_deals_configured_pipeline ON deals(organization_id,pipeline_id,pipeline_stage_id) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS crm_stage_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
  deal_id uuid NOT NULL REFERENCES deals(id),to_stage_id uuid NOT NULL REFERENCES crm_pipeline_stages(id),
  deal_version integer NOT NULL,pipeline_version integer NOT NULL,
  requested_by uuid NOT NULL REFERENCES organization_members(id),requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','consumed')),
  decided_by uuid REFERENCES organization_members(id),decided_at timestamptz,decision_note text NOT NULL DEFAULT '',
  UNIQUE(deal_id,to_stage_id,deal_version,pipeline_version)
);
CREATE TABLE IF NOT EXISTS crm_pipeline_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),
  deal_id uuid NOT NULL REFERENCES deals(id),from_stage_id uuid REFERENCES crm_pipeline_stages(id),to_stage_id uuid REFERENCES crm_pipeline_stages(id),
  previous_close date,next_close date,member_id uuid REFERENCES organization_members(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_pipeline_events_deal ON crm_pipeline_events(organization_id,deal_id,created_at);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['crm_pipelines','crm_pipeline_stages','crm_stage_approvals','crm_pipeline_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS crm_pipeline_read ON public.crm_pipelines;
CREATE POLICY crm_pipeline_read ON public.crm_pipelines FOR SELECT TO authenticated USING(public.can_access_module(organization_id,'crm'));
DROP POLICY IF EXISTS crm_stage_read ON public.crm_pipeline_stages;
CREATE POLICY crm_stage_read ON public.crm_pipeline_stages FOR SELECT TO authenticated USING(public.can_access_module(organization_id,'crm'));
DROP POLICY IF EXISTS crm_approval_read ON public.crm_stage_approvals;
CREATE POLICY crm_approval_read ON public.crm_stage_approvals FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM deals d WHERE d.id=deal_id AND d.organization_id=crm_stage_approvals.organization_id AND d.deleted_at IS NULL AND public.crm_record_visible(d.organization_id,d.owner_id)));
DROP POLICY IF EXISTS crm_pipeline_event_read ON public.crm_pipeline_events;
CREATE POLICY crm_pipeline_event_read ON public.crm_pipeline_events FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM deals d WHERE d.id=deal_id AND d.organization_id=crm_pipeline_events.organization_id AND d.deleted_at IS NULL AND public.crm_record_visible(d.organization_id,d.owner_id)));

CREATE OR REPLACE FUNCTION public.crm_save_pipeline(p_org uuid,p_id uuid,p_version integer,p_name text,p_purpose text,p_stages jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pipeline uuid; current_version integer; item jsonb; stage_id uuid; ids uuid[]; field text; allowed uuid; ordinal integer:=0;
BEGIN
  IF public.auth_role_in(p_org) NOT IN ('owner','administrator') OR public.auth_member_id(p_org) IS NULL THEN RAISE EXCEPTION 'Pipeline management is not permitted' USING ERRCODE='42501'; END IF;
  IF p_stages IS NULL OR jsonb_typeof(p_stages)<>'array' OR jsonb_array_length(p_stages) NOT BETWEEN 2 AND 40 OR p_version IS NULL THEN RAISE EXCEPTION 'A pipeline needs 2 to 40 stages' USING ERRCODE='22023'; END IF;
  IF p_id IS NULL THEN
    IF p_version<>0 THEN RAISE EXCEPTION 'Invalid initial version' USING ERRCODE='22023'; END IF;
    INSERT INTO crm_pipelines(organization_id,name,purpose) VALUES(p_org,p_name,p_purpose) RETURNING id INTO pipeline;
  ELSE
    SELECT id,version INTO pipeline,current_version FROM crm_pipelines WHERE id=p_id AND organization_id=p_org AND NOT archived FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pipeline not found' USING ERRCODE='P0002'; END IF;
    IF current_version<>p_version THEN RAISE EXCEPTION 'Pipeline changed; reload before saving' USING ERRCODE='40001'; END IF;
    UPDATE crm_pipelines SET name=p_name,purpose=p_purpose,version=version+1,updated_at=now() WHERE id=pipeline;
  END IF;
  SELECT array_agg((v->>'id')::uuid) INTO ids FROM jsonb_array_elements(p_stages) v;
  IF array_position(ids,NULL) IS NOT NULL OR cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN RAISE EXCEPTION 'Each stage needs a unique id' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM deals WHERE pipeline_id=pipeline AND deleted_at IS NULL AND NOT(pipeline_stage_id=ANY(ids))) THEN RAISE EXCEPTION 'Move deals before removing their stage' USING ERRCODE='22023'; END IF;
  UPDATE crm_pipeline_stages SET archived=true WHERE pipeline_id=pipeline AND NOT(id=ANY(ids));
  FOR item IN SELECT * FROM jsonb_array_elements(p_stages) LOOP
    stage_id:=(item->>'id')::uuid;
    IF EXISTS(SELECT 1 FROM crm_pipeline_stages WHERE id=stage_id AND (pipeline_id<>pipeline OR organization_id<>p_org)) THEN RAISE EXCEPTION 'Stage belongs to another pipeline' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM deals d JOIN crm_pipeline_stages s ON s.id=d.pipeline_stage_id WHERE s.id=stage_id AND d.deleted_at IS NULL AND s.canonical_stage::text<>(item->>'canonicalStage')) THEN RAISE EXCEPTION 'Cannot change the reporting outcome of an occupied stage' USING ERRCODE='22023'; END IF;
    IF nullif(item->>'ownerId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_members WHERE id=(item->>'ownerId')::uuid AND organization_id=p_org) THEN RAISE EXCEPTION 'Stage owner belongs to another organization' USING ERRCODE='22023'; END IF;
    FOR field IN SELECT jsonb_array_elements_text(coalesce(item->'requiredFields','[]')) UNION SELECT jsonb_array_elements_text(coalesce(item->'exitRequiredFields','[]')) LOOP
      IF field NOT IN ('company_id','contact_id','owner_id','expected_close','value','next_step','notes','lost_reason','competitor','outcome_notes') THEN RAISE EXCEPTION 'Unsupported stage requirement' USING ERRCODE='22023'; END IF;
    END LOOP;
    IF coalesce(item->'requiredFields','[]'::jsonb) ? 'lost_reason' AND item->>'canonicalStage'<>'closed_lost' THEN RAISE EXCEPTION 'Loss reason can only be required in a lost stage' USING ERRCODE='22023'; END IF;
    FOR allowed IN SELECT jsonb_array_elements_text(coalesce(item->'allowedNext','[]'))::uuid LOOP
      IF NOT(allowed=ANY(ids)) THEN RAISE EXCEPTION 'Allowed transitions must stay in this pipeline' USING ERRCODE='22023'; END IF;
    END LOOP;
    INSERT INTO crm_pipeline_stages(id,organization_id,pipeline_id,name,position,canonical_stage,probability,entry_guidance,exit_guidance,required_fields,exit_required_fields,allowed_next,owner_id,inactivity_days,requires_approval)
    VALUES(stage_id,p_org,pipeline,item->>'name',ordinal,(item->>'canonicalStage')::deal_stage,(item->>'probability')::int,
      coalesce(item->>'entryGuidance',''),coalesce(item->>'exitGuidance',''),ARRAY(SELECT jsonb_array_elements_text(coalesce(item->'requiredFields','[]'))),
      ARRAY(SELECT jsonb_array_elements_text(coalesce(item->'exitRequiredFields','[]'))),ARRAY(SELECT jsonb_array_elements_text(coalesce(item->'allowedNext','[]'))::uuid),
      nullif(item->>'ownerId','')::uuid,(item->>'inactivityDays')::int,coalesce((item->>'requiresApproval')::boolean,false))
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,position=excluded.position,canonical_stage=excluded.canonical_stage,probability=excluded.probability,
      entry_guidance=excluded.entry_guidance,exit_guidance=excluded.exit_guidance,required_fields=excluded.required_fields,exit_required_fields=excluded.exit_required_fields,
      allowed_next=excluded.allowed_next,owner_id=excluded.owner_id,inactivity_days=excluded.inactivity_days,requires_approval=excluded.requires_approval,archived=false;
    ordinal:=ordinal+1;
  END LOOP;
  RETURN pipeline;
END $$;
REVOKE ALL ON FUNCTION public.crm_save_pipeline(uuid,uuid,integer,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_pipeline(uuid,uuid,integer,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_enforce_pipeline_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target crm_pipeline_stages%ROWTYPE; previous crm_pipeline_stages%ROWTYPE; configuration_version integer; field text; value jsonb; alternatives integer; transition boolean;
BEGIN
  IF NEW.forecast_category NOT IN ('pipeline','best_case','commit','omitted') THEN RAISE EXCEPTION 'Invalid forecast category' USING ERRCODE='23514'; END IF;
  IF length(NEW.next_step)>4000 OR length(NEW.competitor)>250 OR length(NEW.outcome_notes)>12000 THEN RAISE EXCEPTION 'Deal detail exceeds supported length' USING ERRCODE='23514'; END IF;
  NEW.pipeline_version:=CASE WHEN TG_OP='UPDATE' THEN OLD.pipeline_version+1 ELSE 0 END;
  IF TG_OP='UPDATE' AND OLD.pipeline_id IS NOT NULL AND NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN
    RAISE EXCEPTION 'A configured deal cannot bypass its pipeline by changing or clearing the pipeline' USING ERRCODE='23514';
  END IF;
  IF NEW.pipeline_id IS NULL AND NEW.pipeline_stage_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.pipeline_id IS NULL OR NEW.pipeline_stage_id IS NULL THEN RAISE EXCEPTION 'Select both pipeline and stage' USING ERRCODE='23514'; END IF;
  SELECT version INTO configuration_version FROM crm_pipelines WHERE id=NEW.pipeline_id AND organization_id=NEW.organization_id AND NOT archived FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pipeline unavailable' USING ERRCODE='23514'; END IF;
  -- Legacy clients may submit a canonical stage. Resolve only an unambiguous
  -- destination and still apply exactly the same rules and approval checks.
  IF TG_OP='UPDATE' AND NEW.pipeline_stage_id=OLD.pipeline_stage_id AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    SELECT count(*) INTO alternatives FROM crm_pipeline_stages WHERE pipeline_id=NEW.pipeline_id AND canonical_stage=NEW.stage AND NOT archived;
    IF alternatives<>1 THEN RAISE EXCEPTION 'Choose the exact configured stage in the pipeline workspace' USING ERRCODE='23514'; END IF;
    SELECT id INTO NEW.pipeline_stage_id FROM crm_pipeline_stages WHERE pipeline_id=NEW.pipeline_id AND canonical_stage=NEW.stage AND NOT archived;
  END IF;
  SELECT * INTO target FROM crm_pipeline_stages WHERE id=NEW.pipeline_stage_id AND pipeline_id=NEW.pipeline_id AND organization_id=NEW.organization_id AND NOT archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stage unavailable for this pipeline' USING ERRCODE='23514'; END IF;
  transition:=TG_OP='INSERT';
  IF TG_OP='UPDATE' THEN transition:=NEW.pipeline_stage_id IS DISTINCT FROM OLD.pipeline_stage_id; END IF;
  IF transition THEN
    IF TG_OP='UPDATE' AND OLD.pipeline_stage_id IS NOT NULL THEN
      SELECT * INTO previous FROM crm_pipeline_stages WHERE id=OLD.pipeline_stage_id;
      IF cardinality(previous.allowed_next)>0 AND NOT(target.id=ANY(previous.allowed_next)) THEN RAISE EXCEPTION 'This stage transition is not allowed' USING ERRCODE='23514'; END IF;
      FOREACH field IN ARRAY previous.exit_required_fields LOOP
        value:=to_jsonb(NEW)->field;
        IF value IS NULL OR value='null'::jsonb OR btrim(value#>>'{}')='' OR (field='value' AND NEW.value<=0) THEN RAISE EXCEPTION 'Complete exit requirement: %',field USING ERRCODE='23514'; END IF;
      END LOOP;
    END IF;
    IF target.requires_approval THEN
      IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Create the deal in an earlier stage before requesting approval' USING ERRCODE='23514'; END IF;
      IF (to_jsonb(NEW)-ARRAY['pipeline_stage_id','stage','probability','pipeline_version','updated_at','closed_at','lost_reason','outcome_notes']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['pipeline_stage_id','stage','probability','pipeline_version','updated_at','closed_at','lost_reason','outcome_notes']) THEN RAISE EXCEPTION 'Save deal changes before requesting approval for this transition' USING ERRCODE='23514';END IF;
      UPDATE crm_stage_approvals SET status='consumed' WHERE deal_id=NEW.id AND organization_id=NEW.organization_id AND to_stage_id=target.id AND deal_version=OLD.pipeline_version AND pipeline_version=configuration_version AND status='approved';
      IF NOT FOUND THEN RAISE EXCEPTION 'This transition needs approval for the current deal and pipeline revision' USING ERRCODE='23514'; END IF;
    END IF;
    NEW.probability:=target.probability;
  END IF;
  -- Requirements remain true on ordinary edits, not only drag-and-drop.
  FOREACH field IN ARRAY target.required_fields LOOP
    value:=to_jsonb(NEW)->field;
    IF value IS NULL OR value='null'::jsonb OR btrim(value#>>'{}')='' OR (field='value' AND NEW.value<=0) THEN RAISE EXCEPTION 'Complete stage requirement: %',field USING ERRCODE='23514'; END IF;
  END LOOP;
  NEW.stage:=target.canonical_stage;
  IF transition AND target.canonical_stage='closed_lost' AND coalesce(btrim(NEW.lost_reason),'')='' THEN RAISE EXCEPTION 'Record a loss reason before closing this deal' USING ERRCODE='23514';END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_enforce_pipeline_stage() FROM PUBLIC;
DROP TRIGGER IF EXISTS aaa_crm_pipeline_stage ON public.deals;
CREATE TRIGGER aaa_crm_pipeline_stage BEFORE INSERT OR UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.crm_enforce_pipeline_stage();

CREATE OR REPLACE FUNCTION public.crm_record_pipeline_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.pipeline_id IS NOT NULL THEN INSERT INTO crm_pipeline_events(organization_id,deal_id,to_stage_id,next_close,member_id) VALUES(NEW.organization_id,NEW.id,NEW.pipeline_stage_id,NEW.expected_close,public.auth_member_id(NEW.organization_id)); END IF;
  ELSIF NEW.pipeline_stage_id IS DISTINCT FROM OLD.pipeline_stage_id OR NEW.expected_close IS DISTINCT FROM OLD.expected_close THEN
    INSERT INTO crm_pipeline_events(organization_id,deal_id,from_stage_id,to_stage_id,previous_close,next_close,member_id) VALUES(NEW.organization_id,NEW.id,OLD.pipeline_stage_id,NEW.pipeline_stage_id,OLD.expected_close,NEW.expected_close,public.auth_member_id(NEW.organization_id));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_record_pipeline_event() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_pipeline_event ON public.deals;
CREATE TRIGGER crm_pipeline_event AFTER INSERT OR UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.crm_record_pipeline_event();

CREATE OR REPLACE FUNCTION public.crm_request_stage_approval(p_org uuid,p_deal uuid,p_stage uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d deals%ROWTYPE; config_version integer; result uuid; actor uuid;
BEGIN
  actor:=public.auth_member_id(p_org);
  IF actor IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'Approval request not permitted' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM deals WHERE id=p_deal AND organization_id=p_org AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE='P0002'; END IF;
  SELECT p.version INTO config_version FROM crm_pipelines p JOIN crm_pipeline_stages s ON s.pipeline_id=p.id WHERE s.id=p_stage AND p.id=d.pipeline_id AND s.organization_id=p_org AND NOT p.archived AND NOT s.archived AND s.requires_approval;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stage does not require approval or is unavailable' USING ERRCODE='22023'; END IF;
  INSERT INTO crm_stage_approvals(organization_id,deal_id,to_stage_id,deal_version,pipeline_version,requested_by) VALUES(p_org,p_deal,p_stage,d.pipeline_version,config_version,actor)
    ON CONFLICT(deal_id,to_stage_id,deal_version,pipeline_version) DO UPDATE SET requested_at=crm_stage_approvals.requested_at RETURNING id INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_request_stage_approval(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_request_stage_approval(uuid,uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.crm_decide_stage_approval(p_org uuid,p_id uuid,p_approve boolean,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF public.auth_member_id(p_org) IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator') THEN RAISE EXCEPTION 'Stage approval is not permitted' USING ERRCODE='42501'; END IF;
  IF length(coalesce(p_note,''))>4000 THEN RAISE EXCEPTION 'Decision note is too long' USING ERRCODE='22023'; END IF;
  UPDATE crm_stage_approvals SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,decided_by=public.auth_member_id(p_org),decided_at=now(),decision_note=coalesce(p_note,'')
    WHERE id=p_id AND organization_id=p_org AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending approval not found' USING ERRCODE='P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.crm_decide_stage_approval(uuid,uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_decide_stage_approval(uuid,uuid,boolean,text) TO authenticated;

-- The explicit movement command detects stale boards before applying the
-- same trigger rules used by ordinary edits and older API clients.
CREATE OR REPLACE FUNCTION public.crm_move_deal(p_org uuid,p_deal uuid,p_stage uuid,p_version integer,p_outcome jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d deals%ROWTYPE;
BEGIN
  IF public.auth_member_id(p_org) IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'Deal movement not permitted' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM deals WHERE id=p_deal AND organization_id=p_org AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE='P0002'; END IF;
  IF p_version IS NULL OR d.pipeline_version<>p_version THEN RAISE EXCEPTION 'Deal changed; reload before moving' USING ERRCODE='40001'; END IF;
  IF p_stage IS NULL OR d.pipeline_id IS NULL THEN RAISE EXCEPTION 'Select a configured pipeline and stage' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_outcome)<>'object' OR length(coalesce(p_outcome->>'lostReason',''))>500 OR length(coalesce(p_outcome->>'outcomeNotes',''))>12000 THEN RAISE EXCEPTION 'Invalid outcome details' USING ERRCODE='22023';END IF;
  UPDATE deals SET pipeline_stage_id=p_stage,lost_reason=CASE WHEN p_outcome?'lostReason' THEN p_outcome->>'lostReason' ELSE lost_reason END,outcome_notes=CASE WHEN p_outcome?'outcomeNotes' THEN p_outcome->>'outcomeNotes' ELSE outcome_notes END,closed_at=CASE WHEN coalesce(p_outcome->>'closedAt','')<>'' THEN (p_outcome->>'closedAt')::timestamptz ELSE closed_at END WHERE id=d.id AND organization_id=p_org;
END $$;
REVOKE ALL ON FUNCTION public.crm_move_deal(uuid,uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_move_deal(uuid,uuid,uuid,integer,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_pipeline_summary(p_org uuid,p_pipeline uuid,p_search text DEFAULT '',p_owner uuid DEFAULT NULL,p_from date DEFAULT NULL,p_to date DEFAULT NULL)
RETURNS TABLE(stage_id uuid,deal_count bigint,total_value numeric,weighted_value numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT d.pipeline_stage_id,count(*),coalesce(sum(d.value),0),coalesce(sum(d.value*d.probability/100),0)
 FROM deals d WHERE d.organization_id=p_org AND d.pipeline_id=p_pipeline AND d.deleted_at IS NULL
 AND public.crm_record_visible(d.organization_id,d.owner_id)
 AND (coalesce(p_search,'')='' OR position(lower(p_search) in lower(d.name))>0 OR position(lower(p_search) in lower(coalesce(d.notes,'')))>0)
 AND (p_owner IS NULL OR d.owner_id=p_owner) AND (p_from IS NULL OR d.expected_close>=p_from) AND (p_to IS NULL OR d.expected_close<=p_to)
 GROUP BY d.pipeline_stage_id
$$;
REVOKE ALL ON FUNCTION public.crm_pipeline_summary(uuid,uuid,text,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_summary(uuid,uuid,text,uuid,date,date) TO authenticated;
