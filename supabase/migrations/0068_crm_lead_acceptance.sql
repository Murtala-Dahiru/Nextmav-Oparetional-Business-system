-- Computed columns keep inbox counts and paged drill-downs on identical predicates.
CREATE OR REPLACE FUNCTION public.awaiting_response(l public.leads)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT l.deleted_at IS NULL AND l.converted_contact_id IS NULL AND l.status::text NOT IN ('won','lost')
 AND NOT EXISTS(SELECT 1 FROM crm_activities a WHERE a.organization_id=l.organization_id AND a.lead_id=l.id
 AND a.activity_type IN ('call','email','meeting') AND (a.due_at IS NULL OR a.completed_at IS NOT NULL))
$$;
CREATE OR REPLACE FUNCTION public.overdue_follow_up(l public.leads)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT l.deleted_at IS NULL AND l.converted_contact_id IS NULL AND l.status::text NOT IN ('won','lost')
 AND EXISTS(SELECT 1 FROM crm_activities a WHERE a.organization_id=l.organization_id AND a.lead_id=l.id
 AND a.due_at<now() AND a.completed_at IS NULL)
$$;
REVOKE ALL ON FUNCTION public.awaiting_response(public.leads),public.overdue_follow_up(public.leads) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.awaiting_response(public.leads),public.overdue_follow_up(public.leads) TO authenticated;
CREATE INDEX IF NOT EXISTS crm_lead_followup_lookup ON crm_activities(organization_id,lead_id,due_at) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS crm_lead_views (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id), member_id uuid NOT NULL REFERENCES organization_members(id),
 views jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(views)='array' AND jsonb_array_length(views)<=20),
 version integer NOT NULL DEFAULT 1, UNIQUE(organization_id,member_id)
);
-- Avoid advertising this private preference store as a PostgREST many-to-many
-- organization/member junction, which would make existing auth embeds ambiguous.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_lead_views' AND column_name='id') THEN
  ALTER TABLE crm_lead_views ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
  ALTER TABLE crm_lead_views DROP CONSTRAINT crm_lead_views_pkey;
  ALTER TABLE crm_lead_views ADD PRIMARY KEY(id);
  ALTER TABLE crm_lead_views ADD UNIQUE(organization_id,member_id);
 END IF;
END $$;
ALTER TABLE crm_lead_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_lead_views FROM anon,authenticated;
GRANT SELECT ON crm_lead_views TO authenticated;
DROP POLICY IF EXISTS lead_views_read ON crm_lead_views;
CREATE POLICY lead_views_read ON crm_lead_views FOR SELECT TO authenticated
 USING(member_id=public.auth_member_id(organization_id) AND public.can_access_module(organization_id,'crm'));
CREATE OR REPLACE FUNCTION public.crm_save_lead_views(p_org uuid,p_version integer,p_views jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=public.auth_member_id(p_org); current_version integer; result integer;
BEGIN
 IF actor IS NULL OR NOT public.can_access_module(p_org,'crm') THEN RAISE EXCEPTION 'Not permitted' USING ERRCODE='42501';END IF;
 IF p_views IS NULL OR jsonb_typeof(p_views)<>'array' OR jsonb_array_length(p_views)>20 OR octet_length(p_views::text)>50000 THEN RAISE EXCEPTION 'Invalid views' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lead-views:'||actor::text,0));
 SELECT version INTO current_version FROM crm_lead_views WHERE organization_id=p_org AND member_id=actor;
 IF p_version IS NULL OR p_version<>coalesce(current_version,0) THEN RETURN -1;END IF;
 INSERT INTO crm_lead_views(organization_id,member_id,views) VALUES(p_org,actor,p_views)
 ON CONFLICT(organization_id,member_id) DO UPDATE SET views=excluded.views,version=crm_lead_views.version+1 RETURNING version INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_save_lead_views(uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_lead_views(uuid,integer,jsonb) TO authenticated;

-- Unknown consent never becomes granted implicitly. Capture evidence is retained separately.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS communication_preferences jsonb NOT NULL DEFAULT '{"email":"unknown","phone":"unknown","doNotContact":false,"note":""}';
CREATE TABLE IF NOT EXISTS crm_lead_preference_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 lead_id uuid NOT NULL REFERENCES leads(id), actor_id uuid REFERENCES organization_members(id),
 preferences jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_lead_preference_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_lead_preference_history FROM anon,authenticated;
GRANT SELECT ON crm_lead_preference_history TO authenticated;
DROP POLICY IF EXISTS lead_preferences_read ON crm_lead_preference_history;
CREATE POLICY lead_preferences_read ON crm_lead_preference_history FOR SELECT TO authenticated USING(EXISTS(
 SELECT 1 FROM leads l WHERE l.id=lead_id AND l.organization_id=crm_lead_preference_history.organization_id AND public.crm_record_visible(l.organization_id,l.owner_id)));
CREATE OR REPLACE FUNCTION public.crm_guard_lead_preferences()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.communication_preferences IS DISTINCT FROM OLD.communication_preferences THEN
  IF jsonb_typeof(NEW.communication_preferences) IS DISTINCT FROM 'object' OR
   coalesce(NEW.communication_preferences->>'email','') NOT IN ('unknown','granted','withdrawn') OR
   coalesce(NEW.communication_preferences->>'phone','') NOT IN ('unknown','granted','withdrawn') OR
   jsonb_typeof(NEW.communication_preferences->'doNotContact') IS DISTINCT FROM 'boolean' OR
   jsonb_typeof(NEW.communication_preferences->'note') IS DISTINCT FROM 'string' OR
   coalesce(length(NEW.communication_preferences->>'note'),0)>2000 THEN RAISE EXCEPTION 'Invalid communication preferences' USING ERRCODE='22023'; END IF;
  INSERT INTO crm_lead_preference_history(organization_id,lead_id,actor_id,preferences)
   VALUES(NEW.organization_id,NEW.id,public.auth_member_id(NEW.organization_id),NEW.communication_preferences);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_lead_preferences_audit ON leads;
CREATE TRIGGER crm_lead_preferences_audit AFTER INSERT OR UPDATE OF communication_preferences ON leads FOR EACH ROW EXECUTE FUNCTION public.crm_guard_lead_preferences();
-- A merge cannot discard either identity's opt-out. Retain evidence in the immutable snapshots.
CREATE OR REPLACE FUNCTION public.crm_merge_lead_preferences()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.merged_into_id IS NOT NULL AND OLD.merged_into_id IS NULL THEN
  UPDATE leads SET communication_preferences=communication_preferences || jsonb_build_object(
   'doNotContact',coalesce((communication_preferences->>'doNotContact')::boolean,false) OR coalesce((NEW.communication_preferences->>'doNotContact')::boolean,false),
   'email',CASE WHEN communication_preferences->>'email'='withdrawn' OR NEW.communication_preferences->>'email'='withdrawn' THEN 'withdrawn' ELSE coalesce(communication_preferences->>'email','unknown') END,
   'phone',CASE WHEN communication_preferences->>'phone'='withdrawn' OR NEW.communication_preferences->>'phone'='withdrawn' THEN 'withdrawn' ELSE coalesce(communication_preferences->>'phone','unknown') END)
   WHERE id=NEW.merged_into_id AND organization_id=NEW.organization_id;
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_merge_preferences ON leads;
CREATE TRIGGER crm_merge_preferences AFTER UPDATE OF merged_into_id ON leads FOR EACH ROW EXECUTE FUNCTION public.crm_merge_lead_preferences();
CREATE OR REPLACE FUNCTION public.crm_guard_lead_outreach()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE channel text; blocked boolean;
BEGIN
 -- Historical logging remains available. Scheduling/rescheduling and completing planned outreach are guarded.
 IF TG_OP='UPDATE' AND NEW.activity_type IS NOT DISTINCT FROM OLD.activity_type
 AND NEW.due_at IS NOT DISTINCT FROM OLD.due_at AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at THEN RETURN NEW;END IF;
 IF NEW.due_at IS NULL OR NEW.activity_type NOT IN ('call','email','meeting','followup') THEN RETURN NEW;END IF;
 channel:=CASE WHEN NEW.activity_type='email' THEN 'email' WHEN NEW.activity_type='call' THEN 'phone' ELSE NULL END;
 SELECT EXISTS(SELECT 1 FROM leads l WHERE l.organization_id=NEW.organization_id AND l.merged_into_id IS NULL
 AND (l.id=NEW.lead_id OR (NEW.contact_id IS NOT NULL AND l.converted_contact_id=NEW.contact_id))
 AND ((l.communication_preferences->>'doNotContact')::boolean OR (channel IS NOT NULL AND coalesce(l.communication_preferences->>channel,'unknown')<>'granted')
 OR (NEW.activity_type='followup' AND (l.communication_preferences->>'email'='withdrawn' OR l.communication_preferences->>'phone'='withdrawn')))) INTO blocked;
 IF blocked THEN RAISE EXCEPTION 'Outreach is blocked by this lead''s communication preferences. Review consent before scheduling or completing outreach.' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_lead_outreach_guard ON crm_activities;
CREATE TRIGGER crm_lead_outreach_guard BEFORE INSERT OR UPDATE ON crm_activities FOR EACH ROW EXECUTE FUNCTION public.crm_guard_lead_outreach();
NOTIFY pgrst,'reload schema';
