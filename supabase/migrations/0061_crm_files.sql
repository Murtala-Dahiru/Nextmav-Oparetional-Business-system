CREATE OR REPLACE FUNCTION public.crm_entity_visible(p_org uuid,p_kind text,p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.can_access_module(p_org,'crm') AND CASE p_kind
 WHEN 'lead' THEN EXISTS(SELECT 1 FROM leads WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id))
 WHEN 'deal' THEN EXISTS(SELECT 1 FROM deals WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id))
 WHEN 'contact' THEN EXISTS(SELECT 1 FROM contacts WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL)
 WHEN 'company' THEN EXISTS(SELECT 1 FROM companies WHERE id=p_id AND organization_id=p_org AND deleted_at IS NULL)
 ELSE false END
$$;
REVOKE ALL ON FUNCTION public.crm_entity_visible(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_entity_visible(uuid,text,uuid) TO authenticated;
CREATE TABLE IF NOT EXISTS crm_files (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),record_kind text NOT NULL CHECK(record_kind IN ('lead','contact','company','deal')),
 record_id uuid NOT NULL,filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 250),mime_type text NOT NULL,
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),storage_path text NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES organization_members(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_files_record ON crm_files(organization_id,record_kind,record_id,created_at DESC);
ALTER TABLE public.crm_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_files FROM anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.crm_files TO authenticated;
DROP POLICY IF EXISTS crm_files_read ON public.crm_files;
CREATE POLICY crm_files_read ON public.crm_files FOR SELECT TO authenticated USING(public.crm_entity_visible(organization_id,record_kind,record_id));
DROP POLICY IF EXISTS crm_files_insert ON public.crm_files;
CREATE POLICY crm_files_insert ON public.crm_files FOR INSERT TO authenticated WITH CHECK(public.crm_entity_visible(organization_id,record_kind,record_id) AND public.auth_role_in(organization_id) IN ('owner','administrator','manager','sales_staff') AND created_by=public.auth_member_id(organization_id) AND storage_path=organization_id::text||'/'||record_kind||'/'||record_id::text||'/'||id::text);
DROP POLICY IF EXISTS crm_files_delete ON public.crm_files;
CREATE POLICY crm_files_delete ON public.crm_files FOR DELETE TO authenticated USING(public.crm_entity_visible(organization_id,record_kind,record_id) AND (created_by=public.auth_member_id(organization_id) OR public.auth_role_in(organization_id) IN ('owner','administrator')));
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('crm-files','crm-files',false,10485760,ARRAY['application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) ON CONFLICT(id) DO NOTHING;
-- Restrictive policies are necessary: the established generic organization
-- policies also apply to new buckets and must not widen CRM record visibility.
DROP POLICY IF EXISTS crm_storage_read ON storage.objects;
CREATE POLICY crm_storage_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'crm-files' OR public.crm_entity_visible(public.storage_org_id(name),split_part(name,'/',2),public.storage_org_id(split_part(name,'/',3))));
DROP POLICY IF EXISTS crm_storage_insert ON storage.objects;
CREATE POLICY crm_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>'crm-files' OR (public.crm_entity_visible(public.storage_org_id(name),split_part(name,'/',2),public.storage_org_id(split_part(name,'/',3))) AND public.auth_role_in(public.storage_org_id(name)) IN ('owner','administrator','manager','sales_staff')));
DROP POLICY IF EXISTS crm_storage_update ON storage.objects;
CREATE POLICY crm_storage_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(bucket_id<>'crm-files') WITH CHECK(bucket_id<>'crm-files');
DROP POLICY IF EXISTS crm_storage_delete ON storage.objects;
CREATE POLICY crm_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'crm-files' OR public.crm_entity_visible(public.storage_org_id(name),split_part(name,'/',2),public.storage_org_id(split_part(name,'/',3))));
