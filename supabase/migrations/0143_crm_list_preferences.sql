CREATE TABLE IF NOT EXISTS crm_list_preferences (
 organization_id uuid NOT NULL REFERENCES organizations(id),member_id uuid NOT NULL REFERENCES organization_members(id),
 object text NOT NULL CHECK(object IN ('leads','contacts','companies','deals')),version integer NOT NULL DEFAULT 1,
 settings jsonb NOT NULL,PRIMARY KEY(organization_id,member_id,object)
);
ALTER TABLE crm_list_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_list_preferences FROM PUBLIC,anon,authenticated;
GRANT SELECT ON crm_list_preferences TO authenticated;
DROP POLICY IF EXISTS crm_list_preferences_read ON crm_list_preferences;
CREATE POLICY crm_list_preferences_read ON crm_list_preferences FOR SELECT TO authenticated USING(can_access_module(organization_id,'crm') AND member_id=auth_member_id(organization_id));
CREATE OR REPLACE FUNCTION public.crm_list_preferences_save(p_org uuid,p_object text,p_version integer,p_settings jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth_member_id(p_org); current_version integer; item jsonb;
BEGIN
 IF actor IS NULL OR NOT coalesce(can_access_module(p_org,'crm'),false) THEN RAISE EXCEPTION 'CRM access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,143));
 SELECT version INTO current_version FROM crm_list_preferences WHERE organization_id=p_org AND member_id=actor AND object=p_object;
 IF coalesce(current_version,0) IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'List preferences changed; reload' USING ERRCODE='PT409'; END IF;
 IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object' OR octet_length(p_settings::text)>24000 OR coalesce(p_settings->>'density','') NOT IN ('comfortable','compact') OR jsonb_typeof(p_settings->'hidden') IS DISTINCT FROM 'array' OR jsonb_typeof(p_settings->'order') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid list presentation' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_settings->'hidden')>140 OR jsonb_array_length(p_settings->'order')>140 THEN RAISE EXCEPTION 'Too many list columns' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements((p_settings->'hidden')||(p_settings->'order')) LOOP
  IF jsonb_typeof(item)<>'string' OR length(item#>>'{}') NOT BETWEEN 1 AND 140 THEN RAISE EXCEPTION 'Invalid column identifier' USING ERRCODE='22023'; END IF;
 END LOOP;
 INSERT INTO crm_list_preferences(organization_id,member_id,object,version,settings) VALUES(p_org,actor,p_object,coalesce(current_version,0)+1,p_settings)
 ON CONFLICT(organization_id,member_id,object) DO UPDATE SET version=excluded.version,settings=excluded.settings;
 RETURN coalesce(current_version,0)+1;
END $$;
REVOKE ALL ON FUNCTION crm_list_preferences_save(uuid,text,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_list_preferences_save(uuid,text,integer,jsonb) TO authenticated;
