-- Keep archived sequence runs and their events while regular automation retention continues.
CREATE OR REPLACE FUNCTION public.crm_automation_retention() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids uuid[]; n integer;
BEGIN
 SELECT array_agg(id) INTO ids FROM (SELECT id FROM crm_automation_runs r WHERE NOT EXISTS (SELECT 1 FROM crm_sales_enrollments e WHERE e.run_id=r.id) AND NOT EXISTS (SELECT 1 FROM crm_automation_versions v WHERE v.id=r.version_id AND v.definition->>'trigger'='sales.sequence_enrolled') AND status IN ('succeeded','skipped','cancelled') AND completed_at<now()-interval '90 days' ORDER BY completed_at LIMIT 1000 FOR UPDATE SKIP LOCKED) old_runs;
 DELETE FROM crm_automation_steps WHERE run_id=ANY(ids);
 DELETE FROM crm_automation_runs WHERE id=ANY(ids);GET DIAGNOSTICS n=ROW_COUNT;
 DELETE FROM crm_automation_events WHERE id IN (SELECT e.id FROM crm_automation_events e WHERE created_at<now()-interval '90 days' AND trigger NOT IN ('sales.sequence_enrolled','lead.no_response','deal.stalled','deal.closing_soon','activity.overdue','company.inactive','company.action_overdue') AND NOT EXISTS(SELECT 1 FROM crm_automation_runs r WHERE r.event_id=e.id) ORDER BY created_at LIMIT 1000);
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_retention() FROM PUBLIC,anon,authenticated;
