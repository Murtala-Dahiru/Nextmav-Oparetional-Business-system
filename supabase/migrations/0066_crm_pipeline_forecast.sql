-- Current forecast categories and closed outcomes, aggregated under caller RLS.
-- No historical snapshots are inferred and omitted deals do not inflate forecast.
CREATE OR REPLACE FUNCTION public.crm_pipeline_forecast(p_org uuid,p_pipeline uuid,p_search text DEFAULT '',p_owner uuid DEFAULT NULL,p_from date DEFAULT NULL,p_to date DEFAULT NULL)
RETURNS TABLE(category text,deal_count bigint,total_value numeric,weighted_value numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH visible AS (
  SELECT d.*,CASE WHEN d.stage='closed_won' THEN 'won' WHEN d.stage='closed_lost' THEN 'lost' ELSE d.forecast_category END AS bucket
  FROM deals d WHERE d.organization_id=p_org AND d.pipeline_id=p_pipeline AND d.deleted_at IS NULL
   AND public.crm_record_visible(d.organization_id,d.owner_id)
   AND (coalesce(p_search,'')='' OR position(lower(p_search) in lower(d.name))>0 OR position(lower(p_search) in lower(coalesce(d.notes,'')))>0)
   AND (p_owner IS NULL OR d.owner_id=p_owner)
   AND (p_from IS NULL OR d.expected_close>=p_from) AND (p_to IS NULL OR d.expected_close<=p_to)
 ) SELECT bucket,count(*),coalesce(sum(value),0),
   coalesce(sum(CASE WHEN bucket IN ('won','lost','omitted') THEN 0 ELSE value*probability/100 END),0)
 FROM visible GROUP BY bucket
$$;
REVOKE ALL ON FUNCTION public.crm_pipeline_forecast(uuid,uuid,text,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_forecast(uuid,uuid,text,uuid,date,date) TO authenticated;
