-- Counts use the same row-level visibility as the enrollment list.
CREATE OR REPLACE FUNCTION public.crm_sales_sequence_metrics(p_org uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'enrolled',count(*),
  'active',count(*) FILTER(WHERE state='active'),
  'completed',count(*) FILTER(WHERE state='completed'),
  'paused',count(*) FILTER(WHERE state='paused'),
  'replied',count(*) FILTER(WHERE state='replied'),
  'failed',count(*) FILTER(WHERE state='failed'),
  'opted_out',count(*) FILTER(WHERE state='opted_out'),
  'stopped',count(*) FILTER(WHERE state='stopped'))
 FROM crm_sales_enrollments WHERE organization_id=p_org AND can_access_module(p_org,'crm')
$$;
REVOKE ALL ON FUNCTION public.crm_sales_sequence_metrics(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_sales_sequence_metrics(uuid) TO authenticated;
CREATE INDEX IF NOT EXISTS crm_sales_enrollment_status ON crm_sales_enrollments(organization_id,state);
