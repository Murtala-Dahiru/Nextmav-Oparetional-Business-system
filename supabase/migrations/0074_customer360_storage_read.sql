-- CRM storage requires its own permissive read policy: the generic bucket allow-list excludes crm-files.
-- Existing restrictive record visibility policies still apply, including merged-record checks.
DROP POLICY IF EXISTS crm_storage_authorized_read ON storage.objects;
CREATE POLICY crm_storage_authorized_read ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='crm-files' AND public.crm_file_record_visible(public.storage_org_id(name),split_part(name,'/',2),public.storage_org_id(split_part(name,'/',3))));
