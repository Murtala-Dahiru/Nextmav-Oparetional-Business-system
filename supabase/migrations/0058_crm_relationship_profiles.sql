ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS parent_company_id uuid REFERENCES companies(id);
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS account_team_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT '';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS crm_profile jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS crm_profile_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS crm_profile jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS crm_profile_version integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_companies_parent ON companies(organization_id,parent_company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(organization_id,domain) WHERE deleted_at IS NULL AND domain<>'';
CREATE OR REPLACE FUNCTION public.crm_guard_relationship_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE member uuid; entry jsonb; value jsonb;
BEGIN
 NEW.crm_profile_version:=CASE WHEN TG_OP='UPDATE' THEN OLD.crm_profile_version+1 ELSE 0 END;
 IF jsonb_typeof(NEW.crm_profile)<>'object' OR octet_length(NEW.crm_profile::text)>30000 THEN RAISE EXCEPTION 'Invalid relationship profile' USING ERRCODE='23514';END IF;
 FOR value IN SELECT v FROM jsonb_each(NEW.crm_profile) e(k,v) LOOP
  IF jsonb_typeof(value)='string' AND length(value#>>'{}')>4000 THEN RAISE EXCEPTION 'Profile field is too long' USING ERRCODE='23514';END IF;
 END LOOP;
 IF TG_TABLE_NAME='companies' THEN
  IF NEW.domain<>'' AND (length(NEW.domain)>253 OR NEW.domain!~'^[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$') THEN RAISE EXCEPTION 'Use a normalized company domain without a URL path' USING ERRCODE='23514';END IF;
  IF cardinality(NEW.account_team_ids)>100 THEN RAISE EXCEPTION 'Account team is too large' USING ERRCODE='23514';END IF;
  FOREACH member IN ARRAY NEW.account_team_ids LOOP
   IF NOT EXISTS(SELECT 1 FROM organization_members WHERE id=member AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Account team member belongs to another organization' USING ERRCODE='23514';END IF;
  END LOOP;
  IF NEW.parent_company_id IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('crm-hierarchy:'||NEW.organization_id::text,0));
   IF NOT EXISTS(SELECT 1 FROM companies WHERE id=NEW.parent_company_id AND organization_id=NEW.organization_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Parent account unavailable' USING ERRCODE='23514';END IF;
   IF NEW.parent_company_id=NEW.id OR EXISTS(WITH RECURSIVE parents AS(SELECT id,parent_company_id FROM companies WHERE id=NEW.parent_company_id UNION SELECT c.id,c.parent_company_id FROM companies c JOIN parents p ON c.id=p.parent_company_id WHERE c.organization_id=NEW.organization_id) SELECT 1 FROM parents WHERE id=NEW.id) THEN RAISE EXCEPTION 'Account hierarchy cannot contain a cycle' USING ERRCODE='23514';END IF;
  END IF;
  IF NEW.crm_profile?'tags' THEN IF jsonb_typeof(NEW.crm_profile->'tags')<>'array' OR jsonb_array_length(NEW.crm_profile->'tags')>50 THEN RAISE EXCEPTION 'Invalid account tags' USING ERRCODE='23514';END IF;END IF;
  IF NEW.crm_profile?'customFields' THEN
   IF jsonb_typeof(NEW.crm_profile->'customFields')<>'array' OR jsonb_array_length(NEW.crm_profile->'customFields')>30 THEN RAISE EXCEPTION 'Invalid custom fields' USING ERRCODE='23514';END IF;
   FOR entry IN SELECT * FROM jsonb_array_elements(NEW.crm_profile->'customFields') LOOP
    IF coalesce(length(entry->>'label'),0) NOT BETWEEN 1 AND 100 OR length(coalesce(entry->>'value',''))>4000 THEN RAISE EXCEPTION 'Invalid custom field' USING ERRCODE='23514';END IF;
   END LOOP;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_guard_relationship_profile() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_relationship_profile ON public.companies;
CREATE TRIGGER crm_relationship_profile BEFORE INSERT OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.crm_guard_relationship_profile();
DROP TRIGGER IF EXISTS crm_relationship_profile ON public.contacts;
CREATE TRIGGER crm_relationship_profile BEFORE INSERT OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.crm_guard_relationship_profile();
CREATE OR REPLACE FUNCTION public.crm_save_relationship_profile(p_org uuid,p_kind text,p_id uuid,p_version integer,p_profile jsonb,p_parent uuid,p_team uuid[],p_domain text,p_owner uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE version_now integer;
BEGIN
 IF public.auth_member_id(p_org) IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'Relationship edit not permitted' USING ERRCODE='42501';END IF;
 IF p_owner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_members WHERE id=p_owner AND organization_id=p_org) THEN RAISE EXCEPTION 'Owner belongs to another organization' USING ERRCODE='22023';END IF;
 IF p_kind='company' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-hierarchy:'||p_org::text,0));
  SELECT crm_profile_version INTO version_now FROM companies WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE;
 ELSIF p_kind='contact' THEN
  SELECT crm_profile_version INTO version_now FROM contacts WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE;
 ELSE RAISE EXCEPTION 'Invalid relationship kind' USING ERRCODE='22023';END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Relationship not found' USING ERRCODE='P0002';END IF;
 IF p_version IS NULL OR version_now<>p_version THEN RAISE EXCEPTION 'Relationship changed; reload before saving' USING ERRCODE='40001';END IF;
 IF p_kind='company' THEN UPDATE companies SET crm_profile=p_profile,parent_company_id=p_parent,account_team_ids=coalesce(p_team,'{}'),domain=coalesce(p_domain,''),owner_id=p_owner WHERE id=p_id AND organization_id=p_org;
 ELSE UPDATE contacts SET crm_profile=p_profile,owner_id=p_owner WHERE id=p_id AND organization_id=p_org;END IF;
END $$;
REVOKE ALL ON FUNCTION public.crm_save_relationship_profile(uuid,text,uuid,integer,jsonb,uuid,uuid[],text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_relationship_profile(uuid,text,uuid,integer,jsonb,uuid,uuid[],text,uuid) TO authenticated;
