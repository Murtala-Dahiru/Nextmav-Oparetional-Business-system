-- Defense in depth for service-mediated writes: completion is a state transition,
-- not an arbitrary status update. Preserve every previously recorded action.
CREATE OR REPLACE FUNCTION public.sign_commit(p_id uuid,p_revision integer,p_status text,p_data jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e sign_envelopes%ROWTYPE; old_action jsonb; recipient jsonb;
BEGIN
 SELECT * INTO e FROM sign_envelopes WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR e.revision<>p_revision THEN RETURN false; END IF;
 IF e.status IN ('completed','declined','revoked','expired','changes_requested') THEN RAISE EXCEPTION 'Agreement is closed'; END IF;
 IF e.status<>'draft' AND (p_data->'source' IS DISTINCT FROM e.data->'source' OR p_data->'fields' IS DISTINCT FROM e.data->'fields' OR p_data->'consent' IS DISTINCT FROM e.data->'consent' OR p_data->'expiresAt' IS DISTINCT FROM e.data->'expiresAt' OR p_data->'sequential' IS DISTINCT FROM e.data->'sequential' OR p_data->'title' IS DISTINCT FROM e.data->'title') THEN RAISE EXCEPTION 'Issued document configuration is immutable';END IF;
 IF NOT (CASE e.status WHEN 'draft' THEN p_status IN ('draft','sent','revoked') WHEN 'sent' THEN p_status IN ('sent','in_progress','finalizing','declined','changes_requested','revoked','expired') WHEN 'in_progress' THEN p_status IN ('in_progress','finalizing','declined','changes_requested','revoked','expired') WHEN 'finalizing' THEN p_status IN ('finalizing','completed','revoked') ELSE false END) THEN RAISE EXCEPTION 'Invalid agreement transition';END IF;
 IF p_status IN ('in_progress','finalizing') AND (e.data->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'Agreement expired';END IF;
 FOR old_action IN SELECT value FROM jsonb_array_elements(e.data->'actions') LOOP
 IF NOT (p_data->'actions' @> jsonb_build_array(old_action)) THEN RAISE EXCEPTION 'Recorded signing action cannot be changed';END IF;
 SELECT value INTO recipient FROM jsonb_array_elements(p_data->'recipients') WHERE value->>'id'=old_action->>'recipientId';
 IF recipient IS DISTINCT FROM (SELECT value FROM jsonb_array_elements(e.data->'recipients') WHERE value->>'id'=old_action->>'recipientId') THEN RAISE EXCEPTION 'Completed recipient identity is immutable';END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(p_data->'actions'))<>(SELECT count(DISTINCT value->>'recipientId') FROM jsonb_array_elements(p_data->'actions')) THEN RAISE EXCEPTION 'Duplicate recipient completion';END IF;
 IF p_status IN ('finalizing','completed') AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'recipients') r WHERE r->>'role'<>'viewer') OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'recipients') r WHERE r->>'role'<>'viewer' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'actions') a WHERE a->>'recipientId'=r->>'id'))) THEN RAISE EXCEPTION 'Required recipients are incomplete';END IF;
 IF p_status='completed' AND (p_data->'final'->>'hash' IS NULL OR p_data->'final'->>'certificateHash' IS NULL) THEN RAISE EXCEPTION 'Completion artifacts required';END IF;
 UPDATE sign_envelopes SET status=p_status,data=p_data,title=p_data->>'title',revision=revision+1,updated_at=now() WHERE id=p_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.sign_commit(uuid,integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sign_commit(uuid,integer,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.sign_envelope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM organization_members WHERE id=NEW.owner_id AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid agreement owner';END IF;
 IF NEW.record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_commercial_records WHERE id=NEW.record_id AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid agreement source';END IF;
 IF NEW.version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_commercial_versions WHERE id=NEW.version_id AND record_id=NEW.record_id AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Invalid agreement version';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sign_envelope_guard BEFORE INSERT OR UPDATE OF owner_id,record_id,version_id,organization_id ON sign_envelopes FOR EACH ROW EXECUTE FUNCTION public.sign_envelope_guard();
