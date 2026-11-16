CREATE TABLE IF NOT EXISTS crm_pipeline_views(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),member_id uuid NOT NULL REFERENCES organization_members(id),
 version integer NOT NULL DEFAULT 1,views jsonb NOT NULL DEFAULT '[]',UNIQUE(organization_id,member_id)
);
ALTER TABLE crm_pipeline_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_pipeline_views FROM anon,authenticated;
GRANT SELECT ON crm_pipeline_views TO authenticated;
DROP POLICY IF EXISTS crm_pipeline_views_read ON crm_pipeline_views;
CREATE POLICY crm_pipeline_views_read ON crm_pipeline_views FOR SELECT TO authenticated USING(member_id=auth_member_id(organization_id) AND can_access_module(organization_id,'crm'));
CREATE OR REPLACE FUNCTION public.crm_save_pipeline_views(p_org uuid,p_version integer,p_views jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; current_version integer; item jsonb;
BEGIN
 actor:=auth_member_id(p_org);
 IF actor IS NULL OR NOT can_access_module(p_org,'crm') THEN RAISE EXCEPTION 'Saved views are not permitted' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,87));
 SELECT version INTO current_version FROM crm_pipeline_views WHERE organization_id=p_org AND member_id=actor;
 IF p_version IS NULL OR coalesce(current_version,0)<>p_version THEN RAISE EXCEPTION 'Saved views changed; reload before saving' USING ERRCODE='PT409'; END IF;
 IF jsonb_typeof(p_views) IS DISTINCT FROM 'array' OR jsonb_array_length(p_views)>20 OR octet_length(p_views::text)>64000 THEN RAISE EXCEPTION 'Invalid saved views' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_views) LOOP
  IF length(btrim(coalesce(item->>'name',''))) NOT BETWEEN 1 AND 60 OR jsonb_typeof(item->'filters') IS DISTINCT FROM 'object' OR item->>'view' IS NULL OR item->>'view' NOT IN ('board','table','forecast') OR NOT EXISTS(SELECT 1 FROM crm_pipelines WHERE id=(item->>'pipelineId')::uuid AND organization_id=p_org AND NOT archived) THEN RAISE EXCEPTION 'Invalid saved pipeline view' USING ERRCODE='22023'; END IF;
 END LOOP;
 INSERT INTO crm_pipeline_views(organization_id,member_id,version,views) VALUES(p_org,actor,p_version+1,p_views)
 ON CONFLICT(organization_id,member_id) DO UPDATE SET version=excluded.version,views=excluded.views;
 RETURN p_version+1;
END $$;
REVOKE ALL ON FUNCTION public.crm_save_pipeline_views(uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_pipeline_views(uuid,integer,jsonb) TO authenticated;
