-- Explicit peer relationships complement the existing parent/subsidiary tree.
CREATE TABLE IF NOT EXISTS crm_company_relationships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id),
 related_company_id uuid NOT NULL REFERENCES companies(id),
 relationship_type text NOT NULL CHECK(length(btrim(relationship_type)) BETWEEN 1 AND 80),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES organization_members(id),
 CHECK(company_id<related_company_id),
 UNIQUE(organization_id,company_id,related_company_id,relationship_type)
);
CREATE INDEX IF NOT EXISTS crm_company_relationships_target ON crm_company_relationships(organization_id,related_company_id);
ALTER TABLE public.crm_company_relationships ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.crm_guard_company_relationship() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM companies WHERE id=NEW.company_id AND organization_id=NEW.organization_id AND deleted_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM companies WHERE id=NEW.related_company_id AND organization_id=NEW.organization_id AND deleted_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM organization_members WHERE id=NEW.created_by AND organization_id=NEW.organization_id) THEN
 RAISE EXCEPTION 'Relationship records must belong to this organization' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_guard_company_relationship() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_company_relationship_boundary ON public.crm_company_relationships;
CREATE TRIGGER crm_company_relationship_boundary BEFORE INSERT OR UPDATE ON public.crm_company_relationships FOR EACH ROW EXECUTE FUNCTION public.crm_guard_company_relationship();
DROP POLICY IF EXISTS crm_company_relationship_read ON public.crm_company_relationships;
CREATE POLICY crm_company_relationship_read ON public.crm_company_relationships FOR SELECT TO authenticated USING(public.can_access_module(organization_id,'crm'));
DROP POLICY IF EXISTS crm_company_relationship_insert ON public.crm_company_relationships;
CREATE POLICY crm_company_relationship_insert ON public.crm_company_relationships FOR INSERT TO authenticated WITH CHECK(public.auth_role_in(organization_id) IN('owner','administrator','manager','sales_staff') AND created_by=public.auth_member_id(organization_id));
DROP POLICY IF EXISTS crm_company_relationship_remove ON public.crm_company_relationships;
CREATE POLICY crm_company_relationship_remove ON public.crm_company_relationships FOR DELETE TO authenticated USING(public.auth_role_in(organization_id) IN('owner','administrator','manager','sales_staff'));
GRANT SELECT,INSERT,DELETE ON public.crm_company_relationships TO authenticated;
CREATE OR REPLACE FUNCTION public.crm_audit_company_relationship() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.crm_company_relationships;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 IF NOT EXISTS(SELECT 1 FROM organizations WHERE id=r.organization_id) THEN RETURN r; END IF;
 INSERT INTO activity_log(organization_id,member_id,module,action,title,entity_type,entity_id,metadata)
 SELECT r.organization_id,public.auth_member_id(r.organization_id),'crm',lower(TG_OP),
 CASE WHEN TG_OP='DELETE' THEN 'Removed account relationship: ' ELSE 'Linked account relationship: ' END||r.relationship_type,
 'company',account,jsonb_build_object('relationshipId',r.id,'companyId',r.company_id,'relatedCompanyId',r.related_company_id)
 FROM unnest(ARRAY[r.company_id,r.related_company_id]) account;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.crm_audit_company_relationship() FROM PUBLIC;
DROP TRIGGER IF EXISTS crm_company_relationship_audit ON public.crm_company_relationships;
CREATE TRIGGER crm_company_relationship_audit AFTER INSERT OR DELETE ON public.crm_company_relationships FOR EACH ROW EXECUTE FUNCTION public.crm_audit_company_relationship();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='crm_company_relationships') THEN
 ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_company_relationships;
 END IF;
END $$;
