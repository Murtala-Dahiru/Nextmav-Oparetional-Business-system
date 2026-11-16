ALTER TABLE crm_pipelines ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '' CHECK(length(description)<=4000);
ALTER TABLE crm_pipelines ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE crm_pipelines ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_pipeline_default ON crm_pipelines(organization_id) WHERE is_default;

CREATE OR REPLACE FUNCTION public.crm_pipeline_lifecycle(p_org uuid,p_id uuid,p_version integer,p_description text,p_active boolean,p_default boolean,p_archive boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p crm_pipelines%ROWTYPE;
BEGIN
 IF public.auth_member_id(p_org) IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator') THEN RAISE EXCEPTION 'Pipeline management is not permitted' USING ERRCODE='42501'; END IF;
 -- Serialize default selection across pipelines in the same organization.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text,82));
 SELECT * INTO p FROM crm_pipelines WHERE id=p_id AND organization_id=p_org AND NOT archived FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pipeline not found' USING ERRCODE='P0002'; END IF;
 IF p_version IS NULL OR p.version<>p_version THEN RAISE EXCEPTION 'Pipeline changed; reload before saving' USING ERRCODE='40001'; END IF;
 IF p_active IS NULL OR p_default IS NULL OR p_archive IS NULL OR p_description IS NULL OR length(p_description)>4000 THEN RAISE EXCEPTION 'Invalid pipeline settings' USING ERRCODE='22023'; END IF;
 IF p_default AND (NOT p_active OR p_archive) THEN RAISE EXCEPTION 'The default pipeline must remain active' USING ERRCODE='22023'; END IF;
 IF p_archive AND EXISTS(SELECT 1 FROM deals WHERE pipeline_id=p_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'This pipeline contains deals. Deactivate it to preserve access to their history.' USING ERRCODE='23514'; END IF;
 IF p_default THEN UPDATE crm_pipelines SET is_default=false,version=version+1 WHERE organization_id=p_org AND is_default AND id<>p_id; END IF;
 UPDATE crm_pipelines SET description=p_description,active=p_active AND NOT p_archive,is_default=p_default,archived=p_archive,version=version+1,updated_at=now() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.crm_pipeline_lifecycle(uuid,uuid,integer,text,boolean,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_lifecycle(uuid,uuid,integer,text,boolean,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_check_pipeline_intake()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.pipeline_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id) THEN
  PERFORM 1 FROM crm_pipelines WHERE id=NEW.pipeline_id AND organization_id=NEW.organization_id AND active AND NOT archived FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pipeline is not accepting new deals' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_check_pipeline_intake() FROM PUBLIC;
DROP TRIGGER IF EXISTS aab_crm_pipeline_intake ON deals;
CREATE TRIGGER aab_crm_pipeline_intake BEFORE INSERT OR UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION public.crm_check_pipeline_intake();
