-- Expose newly added details through the existing security-invoker timeline.
CREATE OR REPLACE VIEW public.crm_visible_activities WITH(security_invoker=true) AS
 SELECT a.id,a.organization_id,a.activity_type,a.subject,a.body,a.lead_id,a.contact_id,a.company_id,a.deal_id,a.member_id,a.due_at,a.completed_at,a.created_at,a.updated_at,a.remind_at,a.reminder_sent_at,
 coalesce(a.company_id,c.company_id,d.company_id) AS account_company_id,a.engagement_details
 FROM crm_activities a
 LEFT JOIN contacts c ON c.id=a.contact_id AND c.organization_id=a.organization_id AND c.deleted_at IS NULL
 LEFT JOIN deals d ON d.id=a.deal_id AND d.organization_id=a.organization_id AND d.deleted_at IS NULL
 WHERE public.can_access_module(a.organization_id,'crm')
 AND (a.deal_id IS NULL OR (d.id IS NOT NULL AND public.crm_record_visible(d.organization_id,d.owner_id)))
 AND (a.lead_id IS NULL OR EXISTS(SELECT 1 FROM leads l WHERE l.id=a.lead_id AND l.organization_id=a.organization_id AND l.deleted_at IS NULL AND public.crm_record_visible(l.organization_id,l.owner_id)));

CREATE OR REPLACE FUNCTION public.crm_sales_meeting_integrity() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.engagement_details ? 'ends_at' THEN
  IF NEW.activity_type<>'meeting' OR NEW.due_at IS NULL OR (NEW.engagement_details->>'ends_at')::timestamptz<=NEW.due_at OR (NEW.engagement_details->>'ends_at')::timestamptz>NEW.due_at+interval '24 hours' THEN RAISE EXCEPTION 'Meeting end must follow its start within 24 hours' USING ERRCODE='22023'; END IF;
 END IF;
 IF NEW.engagement_details ? 'timezone' AND NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.engagement_details->>'timezone') THEN RAISE EXCEPTION 'Invalid meeting timezone' USING ERRCODE='22023'; END IF;
 IF NEW.engagement_details ? 'video_url' AND coalesce(NEW.engagement_details->>'video_url','')<>'' AND NEW.engagement_details->>'video_url' !~ '^https://' THEN RAISE EXCEPTION 'Use an HTTPS meeting link' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_sales_meeting_integrity ON crm_activities;
CREATE TRIGGER crm_sales_meeting_integrity BEFORE INSERT OR UPDATE OF engagement_details,due_at,activity_type ON crm_activities FOR EACH ROW EXECUTE FUNCTION public.crm_sales_meeting_integrity();
REVOKE ALL ON FUNCTION public.crm_sales_meeting_integrity() FROM PUBLIC,anon,authenticated;

-- Published sequences have immutable definitions; general automation editing must
-- not bypass their intentionally narrower action vocabulary.
CREATE OR REPLACE FUNCTION public.crm_sales_sequence_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM crm_sales_sequences WHERE automation_id=OLD.id) AND (NEW.draft IS DISTINCT FROM OLD.draft OR NEW.published_version IS DISTINCT FROM OLD.published_version) THEN RAISE EXCEPTION 'Published sales sequence steps are immutable; create a new sequence' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_sales_sequence_immutable ON crm_automations;
CREATE TRIGGER crm_sales_sequence_immutable BEFORE UPDATE OF draft,published_version ON crm_automations FOR EACH ROW EXECUTE FUNCTION public.crm_sales_sequence_immutable();
REVOKE ALL ON FUNCTION public.crm_sales_sequence_immutable() FROM PUBLIC,anon,authenticated;
