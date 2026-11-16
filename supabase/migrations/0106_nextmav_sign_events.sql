-- Extend the existing durable Automation Studio dispatcher and worker.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('crm_automation_validate(jsonb)'::regprocedure) INTO definition;
 IF position('agreement.completed' in definition)=0 THEN
 definition:=replace(definition,'''commercial.contract_executed'')','''commercial.contract_executed'',''agreement.sent'',''agreement.completed'',''agreement.declined'',''agreement.changes_requested'')');
 definition:=replace(definition,'WHEN ''commercial'' THEN f IN','WHEN ''agreement'' THEN f IN (''status'',''owner_id'') WHEN ''commercial'' THEN f IN');
 EXECUTE definition;
 END IF;
 SELECT pg_get_functiondef('crm_automation_worker(integer,uuid)'::regprocedure) INTO definition;
 IF position('WHEN ''agreement'' THEN SELECT' in definition)=0 THEN
 definition:=replace(definition,'WHEN ''commercial'' THEN SELECT','WHEN ''agreement'' THEN SELECT jsonb_build_object(''status'',x.status,''owner_id'',x.owner_id) INTO live FROM sign_envelopes x WHERE id=e.record_id AND organization_id=job.organization_id FOR UPDATE; WHEN ''commercial'' THEN SELECT');
 EXECUTE definition;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sign_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status<>OLD.status AND NEW.status IN ('sent','completed','declined','changes_requested') THEN
 PERFORM crm_automation_emit(NEW.organization_id,'agreement.'||NEW.status,'agreement',NEW.id,jsonb_build_object('status',NEW.status,'owner_id',NEW.owner_id));
 IF NEW.status IN ('completed','declined','changes_requested') THEN
 INSERT INTO notifications(organization_id,recipient_id,type,title,body,entity_type,entity_id)
 VALUES(NEW.organization_id,NEW.owner_id,'crm_automation','Agreement '||replace(NEW.status,'_',' '),NEW.title,'agreement',NEW.id);
 END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sign_capture() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sign_capture ON sign_envelopes;
CREATE TRIGGER sign_capture AFTER UPDATE OF status ON sign_envelopes FOR EACH ROW EXECUTE FUNCTION public.sign_capture();
