-- Match the existing BOS department grant for owned CRM records. A manager
-- without a department can still work their own records. Directory entities
-- remain shared reference data under their existing policies.
CREATE OR REPLACE FUNCTION public.crm_record_visible(org uuid, record_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(can_access_module(org,'crm') AND CASE auth_role_in(org)::text
  WHEN 'sales_staff' THEN record_owner=auth_member_id(org)
  WHEN 'manager' THEN record_owner=auth_member_id(org) OR EXISTS(
   SELECT 1 FROM organization_members viewer JOIN organization_members assigned
    ON assigned.organization_id=viewer.organization_id AND assigned.department_id=viewer.department_id
   WHERE viewer.id=auth_member_id(org) AND viewer.organization_id=org AND assigned.id=record_owner
    AND viewer.department_id IS NOT NULL AND assigned.is_active AND assigned.deleted_at IS NULL)
  ELSE true END,false)
$$;
REVOKE ALL ON FUNCTION crm_record_visible(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_record_visible(uuid,uuid) TO authenticated;
