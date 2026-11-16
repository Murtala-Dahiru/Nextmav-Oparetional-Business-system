-- Extend the existing per-membership saved-view pattern to the shared directory.
CREATE TABLE IF NOT EXISTS crm_directory_views (
 organization_id uuid NOT NULL REFERENCES organizations(id), member_id uuid NOT NULL REFERENCES organization_members(id),
 object text NOT NULL CHECK(object IN ('contacts','companies')),
 version integer NOT NULL DEFAULT 1, views jsonb NOT NULL DEFAULT '[]', PRIMARY KEY(organization_id,member_id,object)
);
ALTER TABLE crm_directory_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_directory_views FROM anon,authenticated;
GRANT SELECT ON crm_directory_views TO authenticated;
DROP POLICY IF EXISTS crm_directory_views_read ON crm_directory_views;
CREATE POLICY crm_directory_views_read ON crm_directory_views FOR SELECT TO authenticated USING(member_id=auth_member_id(organization_id) AND can_access_module(organization_id,'crm'));
CREATE OR REPLACE FUNCTION public.crm_directory_views_save(p_org uuid,p_object text,p_version integer,p_views jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; current_version integer; item jsonb; filter_key text;
BEGIN
 actor:=auth_member_id(p_org);
 IF actor IS NULL OR NOT coalesce(can_access_module(p_org,'crm'),false) THEN RAISE EXCEPTION 'CRM access required' USING ERRCODE='42501'; END IF;
 IF p_object IS NULL OR p_object NOT IN ('contacts','companies') THEN RAISE EXCEPTION 'Invalid directory object' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,133));
 SELECT version INTO current_version FROM crm_directory_views WHERE organization_id=p_org AND member_id=actor AND object=p_object;
 IF p_version IS DISTINCT FROM coalesce(current_version,0) THEN RAISE EXCEPTION 'Views changed; reload' USING ERRCODE='PT409'; END IF;
 IF jsonb_typeof(p_views) IS DISTINCT FROM 'array' OR octet_length(p_views::text)>64000 THEN RAISE EXCEPTION 'Invalid views' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_views)>20 THEN RAISE EXCEPTION 'At most twenty views' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_views) LOOP
  IF length(btrim(coalesce(item->>'name',''))) NOT BETWEEN 1 AND 60 OR length(coalesce(item->>'search',''))>250 OR coalesce(item->>'sortDir','') NOT IN ('asc','desc') OR coalesce(item->>'sort','') NOT IN ('createdAt','updatedAt','name','industry','employeeCount','annualRevenue','firstName','lastName','email') OR jsonb_typeof(item->'columns') IS DISTINCT FROM 'array' OR jsonb_typeof(item->'filters') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid view' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(item->'columns')>30 OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'columns') c WHERE jsonb_typeof(c)<>'string' OR length(c#>>'{}')>100) THEN RAISE EXCEPTION 'Invalid columns' USING ERRCODE='22023'; END IF;
  FOR filter_key IN SELECT jsonb_object_keys(item->'filters') LOOP
   IF filter_key NOT IN ('industry','ownerId','country','parentCompanyId','domain','companyId','isActive','relationshipRole','segment','tag','custom') OR jsonb_typeof(item->'filters'->filter_key)<>'string' OR length(item->'filters'->>filter_key)>12000 THEN RAISE EXCEPTION 'Unsupported filter' USING ERRCODE='22023'; END IF;
  END LOOP;
 END LOOP;
 INSERT INTO crm_directory_views(organization_id,member_id,object,version,views) VALUES(p_org,actor,p_object,coalesce(current_version,0)+1,p_views)
 ON CONFLICT(organization_id,member_id,object) DO UPDATE SET version=excluded.version,views=excluded.views;
 RETURN coalesce(current_version,0)+1;
END $$;
REVOKE ALL ON FUNCTION crm_directory_views_save(uuid,text,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_directory_views_save(uuid,text,integer,jsonb) TO authenticated;
