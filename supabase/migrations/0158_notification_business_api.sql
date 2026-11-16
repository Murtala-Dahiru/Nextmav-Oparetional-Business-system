-- Consume meaningful events already committed to the Business API ledger.
-- Deal wins/losses and invoice payments already have notification producers.
CREATE OR REPLACE FUNCTION public.notification_business_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.event_type IN ('lead.qualified','deal.reopened') AND NEW.subject_member_id IS NOT NULL AND NEW.subject_member_id IS DISTINCT FROM NEW.actor_member_id THEN
 INSERT INTO notifications(organization_id,recipient_id,type,title,body,entity_type,entity_id,link,dedupe_key)
 VALUES(NEW.organization_id,NEW.subject_member_id,replace(NEW.event_type,'.','_'),CASE NEW.event_type WHEN 'lead.qualified' THEN 'Lead qualified' ELSE 'Opportunity reopened' END,
 'Review the record in CRM.',NEW.entity_type,NEW.entity_id,'/dashboard?module=crm&'||NEW.entity_type||'='||NEW.entity_id,'business:'||NEW.idempotency_key) ON CONFLICT DO NOTHING;
 END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notification_business_event() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notification_business_event ON business_events;
CREATE TRIGGER notification_business_event AFTER INSERT ON business_events FOR EACH ROW EXECUTE FUNCTION public.notification_business_event();

DO $$ DECLARE definition text; BEGIN
 SELECT rtrim(pg_get_viewdef('public.notification_deadlines'::regclass),E' ;\n\r\t') INTO definition;
 IF position('invoice_deadline' IN definition)=0 THEN
 EXECUTE 'CREATE OR REPLACE VIEW public.notification_deadlines WITH (security_invoker=true) AS '||definition||
 ' UNION ALL SELECT i.organization_id,i.owner_id,''invoice_deadline'',''invoice'',i.id,i.id,i.due_date::timestamp AT TIME ZONE o.timezone,''finance'',''invoice''
 FROM invoices i JOIN organizations o ON o.id=i.organization_id WHERE i.status IN (''sent'',''partially_paid'',''overdue'') AND i.deleted_at IS NULL AND i.amount_paid<i.total';
 END IF;
 SELECT pg_get_functiondef('public.notification_sweep_deadlines(integer)'::regprocedure) INTO definition;
 IF position('Payment deadline approaching' IN definition)=0 THEN EXECUTE replace(definition,'WHEN ''sign_deadline'' THEN','WHEN ''invoice_deadline'' THEN ''Payment deadline approaching'' WHEN ''sign_deadline'' THEN'); END IF;
END $$;
