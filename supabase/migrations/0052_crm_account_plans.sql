-- Account planning: additive, revisioned and tenant-isolated. No existing rows changed.
CREATE TABLE IF NOT EXISTS crm_account_plans (
  company_id uuid PRIMARY KEY REFERENCES companies(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  objectives text NOT NULL DEFAULT '' CHECK (length(objectives) <= 12000),
  stakeholders text NOT NULL DEFAULT '' CHECK (length(stakeholders) <= 12000),
  opportunities text NOT NULL DEFAULT '' CHECK (length(opportunities) <= 12000),
  risks text NOT NULL DEFAULT '' CHECK (length(risks) <= 12000),
  actions text NOT NULL DEFAULT '' CHECK (length(actions) <= 12000),
  owner_id uuid REFERENCES organization_members(id),
  review_date date,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES organization_members(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_account_plans_review ON crm_account_plans(organization_id,review_date);
CREATE TABLE IF NOT EXISTS crm_account_plan_revisions (
  company_id uuid NOT NULL REFERENCES companies(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid NOT NULL REFERENCES organization_members(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,version)
);
ALTER TABLE public.crm_account_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_account_plan_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_plan_read ON public.crm_account_plans;
CREATE POLICY account_plan_read ON public.crm_account_plans FOR SELECT TO authenticated USING (
  public.can_access_module(organization_id,'crm') AND EXISTS (
    SELECT 1 FROM public.companies c WHERE c.id=company_id AND c.organization_id=crm_account_plans.organization_id AND c.deleted_at IS NULL));
DROP POLICY IF EXISTS account_plan_revision_read ON public.crm_account_plan_revisions;
CREATE POLICY account_plan_revision_read ON public.crm_account_plan_revisions FOR SELECT TO authenticated USING (
  public.can_access_module(organization_id,'crm') AND EXISTS (
    SELECT 1 FROM public.companies c WHERE c.id=company_id AND c.organization_id=crm_account_plan_revisions.organization_id AND c.deleted_at IS NULL));
REVOKE ALL ON public.crm_account_plans, public.crm_account_plan_revisions FROM anon, authenticated;
GRANT SELECT ON public.crm_account_plans, public.crm_account_plan_revisions TO authenticated;

-- Only this narrow command may mutate plans. Every identifier is checked inside
-- the transaction; optimistic versions prevent silently overwriting a colleague.
CREATE OR REPLACE FUNCTION public.crm_save_account_plan(
  p_org uuid,p_company uuid,p_version integer,p_plan jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; existing_version integer; saved public.crm_account_plans%ROWTYPE; owner_member uuid;
BEGIN
  actor := public.auth_member_id(p_org);
  IF actor IS NULL OR public.auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN
    RAISE EXCEPTION 'Account plan editing is not permitted' USING ERRCODE='42501';
  END IF;
  IF p_version IS NULL OR p_version < 0 OR p_plan IS NULL OR jsonb_typeof(p_plan)<>'object' THEN
    RAISE EXCEPTION 'Invalid account plan' USING ERRCODE='22023';
  END IF;
  -- Lock the parent even for first insert, serializing competing first saves.
  PERFORM 1 FROM public.companies WHERE id=p_company AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company not found' USING ERRCODE='P0002'; END IF;
  SELECT version INTO existing_version FROM public.crm_account_plans WHERE company_id=p_company AND organization_id=p_org;
  IF coalesce(existing_version,0)<>p_version THEN
    RAISE EXCEPTION 'Account plan changed; reload before saving' USING ERRCODE='40001';
  END IF;
  owner_member := nullif(p_plan->>'ownerId','')::uuid;
  IF owner_member IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members WHERE id=owner_member AND organization_id=p_org) THEN
    RAISE EXCEPTION 'Owner must belong to this organization' USING ERRCODE='22023';
  END IF;
  INSERT INTO crm_account_plans(company_id,organization_id,objectives,stakeholders,opportunities,risks,actions,owner_id,review_date,version,updated_by)
  VALUES(p_company,p_org,coalesce(p_plan->>'objectives',''),coalesce(p_plan->>'stakeholders',''),coalesce(p_plan->>'opportunities',''),coalesce(p_plan->>'risks',''),coalesce(p_plan->>'actions',''),owner_member,nullif(p_plan->>'reviewDate','')::date,p_version+1,actor)
  ON CONFLICT(company_id) DO UPDATE SET objectives=excluded.objectives,stakeholders=excluded.stakeholders,
    opportunities=excluded.opportunities,risks=excluded.risks,actions=excluded.actions,owner_id=excluded.owner_id,
    review_date=excluded.review_date,version=excluded.version,updated_by=actor,updated_at=now()
  RETURNING * INTO saved;
  INSERT INTO crm_account_plan_revisions(company_id,organization_id,version,snapshot,changed_by)
  VALUES(p_company,p_org,saved.version,to_jsonb(saved),actor);
  RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.crm_save_account_plan(uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_account_plan(uuid,uuid,integer,jsonb) TO authenticated;
