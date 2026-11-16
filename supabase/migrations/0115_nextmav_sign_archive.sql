ALTER TABLE sign_envelopes ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE TABLE IF NOT EXISTS sign_archive_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),
 envelope_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES organization_members(id),
 archived boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,envelope_id) REFERENCES sign_envelopes(organization_id,id)
);
ALTER TABLE sign_archive_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sign_archive_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON sign_archive_audit TO authenticated;
CREATE POLICY sign_archive_read ON sign_archive_audit FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM sign_envelopes e WHERE e.id=envelope_id AND e.organization_id=sign_archive_audit.organization_id));
CREATE OR REPLACE FUNCTION public.sign_archive(p_id uuid,p_archived boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e sign_envelopes%ROWTYPE;
BEGIN
 SELECT * INTO e FROM sign_envelopes WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR coalesce(auth_role_in(e.organization_id),'') NOT IN ('owner','administrator','manager','sales_staff') OR NOT crm_record_visible(e.organization_id,e.owner_id) OR (e.record_id IS NOT NULL AND NOT crm_commercial_visible(e.organization_id,e.record_id)) THEN RAISE EXCEPTION 'Agreement unavailable' USING ERRCODE='42501';END IF;
 IF p_archived AND e.status IN ('sent','in_progress','finalizing') THEN RAISE EXCEPTION 'Complete or revoke an active agreement before archiving';END IF;
 IF (e.archived_at IS NOT NULL)=p_archived THEN RETURN;END IF;
 UPDATE sign_envelopes SET archived_at=CASE WHEN p_archived THEN now() ELSE NULL END WHERE id=p_id;
 IF p_archived THEN DELETE FROM sign_credentials WHERE envelope_id=p_id AND organization_id=e.organization_id;END IF;
 INSERT INTO sign_archive_audit(organization_id,envelope_id,actor_id,archived) VALUES(e.organization_id,e.id,auth_member_id(e.organization_id),p_archived);
END $$;
REVOKE ALL ON FUNCTION public.sign_archive(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sign_archive(uuid,boolean) TO authenticated;
