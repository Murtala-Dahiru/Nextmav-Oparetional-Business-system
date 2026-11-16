ALTER TABLE notifications ADD COLUMN IF NOT EXISTS in_app boolean NOT NULL DEFAULT true;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'system';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

CREATE OR REPLACE FUNCTION public.notification_category(kind text,entity text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
SELECT CASE WHEN entity='agreement' OR kind LIKE 'sign\_%' THEN 'sign'
 WHEN split_part(kind,'_',1) IN ('message','mention','channel','meeting') THEN 'communication'
 WHEN split_part(kind,'_',1) IN ('task','project','milestone','deliverable') THEN 'projects'
 WHEN split_part(kind,'_',1) IN ('leave','hr','employee','attendance','review','payslip') THEN 'hr'
 WHEN split_part(kind,'_',1) IN ('lead','deal','crm') THEN 'crm'
 WHEN split_part(kind,'_',1) IN ('expense','invoice','payment') THEN 'finance'
 WHEN split_part(kind,'_',1) IN ('ticket','support') THEN 'support'
 WHEN split_part(kind,'_',1)='commercial' THEN 'commercial' ELSE 'system' END
$$;
CREATE OR REPLACE FUNCTION public.notification_classify() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prefs jsonb;
BEGIN
 NEW.category:=notification_category(NEW.type,NEW.entity_type);
 NEW.priority:=CASE WHEN NEW.type='access_changed' THEN 'critical' WHEN NEW.type IN ('message_mention','task_overdue','commercial_pending_approval','deal_approval_pending','ticket_deadline') THEN 'high' ELSE 'normal' END;
 SELECT notification_prefs INTO prefs FROM organization_members WHERE id=NEW.recipient_id AND organization_id=NEW.organization_id;
 NEW.in_app:=NEW.priority='critical' OR coalesce(prefs->'inAppCategories'->>NEW.category,'true')<>'false';
 IF NEW.entity_type='agreement' AND NEW.link IS NULL THEN NEW.link:='/dashboard?module=crm&agreement='||NEW.entity_id; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notification_classify() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_classify ON notifications;
CREATE TRIGGER notification_classify BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION public.notification_classify();

-- Preserve pre-existing preference keys owned by other platform features.
CREATE OR REPLACE FUNCTION public.notification_preferences(p_org uuid,p_prefs jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=auth_member_id(p_org);
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Membership required' USING ERRCODE='42501'; END IF;
 IF p_prefs IS NULL OR jsonb_typeof(p_prefs)<>'object' OR length(p_prefs::text)>4000 THEN RAISE EXCEPTION 'Invalid preferences' USING ERRCODE='22023'; END IF;
 UPDATE organization_members SET notification_prefs=notification_prefs||p_prefs WHERE id=me;
 RETURN p_prefs;
END $$;
