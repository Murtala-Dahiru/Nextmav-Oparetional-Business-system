-- A replacement becomes authoritative only on issue/activation, preserving old snapshots.
CREATE OR REPLACE FUNCTION public.crm_commercial_supersede() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous crm_commercial_records%ROWTYPE;
BEGIN
 IF NEW.parent_id IS NULL OR NEW.status=OLD.status OR NOT ((NEW.kind IN ('quote','proposal') AND NEW.status='issued') OR (NEW.kind='contract' AND NEW.status='active')) THEN RETURN NEW;END IF;
 SELECT * INTO previous FROM crm_commercial_records WHERE id=NEW.parent_id AND organization_id=NEW.organization_id AND kind=NEW.kind FOR UPDATE;
 IF FOUND AND previous.status IN ('issued','sent','shared','approved','active','executed') THEN
  UPDATE crm_commercial_records SET status='superseded',revision=revision+1,updated_at=now() WHERE id=previous.id;
  INSERT INTO crm_commercial_history(organization_id,record_id,revision,operation,note,actor_id) VALUES(NEW.organization_id,previous.id,previous.revision,'superseded','Replaced by '||NEW.number,auth_member_id(NEW.organization_id));
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_commercial_supersede() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS commercial_supersede ON crm_commercial_records;
CREATE TRIGGER commercial_supersede AFTER UPDATE OF status ON crm_commercial_records FOR EACH ROW EXECUTE FUNCTION public.crm_commercial_supersede();

-- Exact totals are still returned from pricing JSON. Prevent pathological input from
-- bypassing the HTTP schema through a direct authenticated RPC call.
CREATE OR REPLACE FUNCTION public.crm_commercial_content_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb; field text;
BEGIN
 IF octet_length(NEW.content::text)>200000 THEN RAISE EXCEPTION 'Document exceeds supported size' USING ERRCODE='22023';END IF;
 FOREACH field IN ARRAY ARRAY['paymentTerms','deliveryTerms','notes','internalNotes','parties','terminationTerms'] LOOP
  IF length(coalesce(NEW.content->>field,''))>8000 THEN RAISE EXCEPTION 'Commercial text exceeds supported length' USING ERRCODE='22023';END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.content->'items') LOOP
  IF length(coalesce(item->>'unit',''))>40 THEN RAISE EXCEPTION 'Invalid line unit' USING ERRCODE='22023';END IF;
 END LOOP;
 IF NEW.parent_id=NEW.id THEN RAISE EXCEPTION 'A record cannot reference itself as its predecessor' USING ERRCODE='22023';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_commercial_content_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS commercial_content_guard ON crm_commercial_records;
CREATE TRIGGER commercial_content_guard BEFORE INSERT OR UPDATE OF content,parent_id ON crm_commercial_records FOR EACH ROW EXECUTE FUNCTION public.crm_commercial_content_guard();
