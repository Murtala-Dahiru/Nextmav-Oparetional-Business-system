-- CRM foundation: restrict direct access and make conversion atomic.
-- Additive schema; no records are rewritten. Rollback guidance: docs/CRM-3-PROGRESS.md.
CREATE OR REPLACE FUNCTION public.crm_record_visible(org uuid, record_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT coalesce(public.can_access_module(org, 'crm') AND
    (public.auth_role_in(org) <> 'sales_staff' OR record_owner = public.auth_member_id(org)), false);
$$;
REVOKE ALL ON FUNCTION public.crm_record_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_record_visible(uuid, uuid) TO authenticated;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['leads','deals'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS crm_owner_boundary ON public.%I', t);
    EXECUTE format('CREATE POLICY crm_owner_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.crm_record_visible(organization_id, owner_id)) WITH CHECK (public.crm_record_visible(organization_id, owner_id))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['leads','deals','companies','contacts','crm_activities'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS crm_insert_capability ON public.%I', t);
    EXECUTE format('CREATE POLICY crm_insert_capability ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.auth_role_in(organization_id) IN (''owner'',''administrator'',''manager'',''sales_staff''))', t);
    EXECUTE format('DROP POLICY IF EXISTS crm_update_capability ON public.%I', t);
    EXECUTE format('CREATE POLICY crm_update_capability ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.auth_role_in(organization_id) IN (''owner'',''administrator'',''manager'',''sales_staff'')) WITH CHECK (public.auth_role_in(organization_id) IN (''owner'',''administrator'',''manager'',''sales_staff''))', t);
    EXECUTE format('DROP POLICY IF EXISTS crm_delete_capability ON public.%I', t);
    EXECUTE format('CREATE POLICY crm_delete_capability ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.auth_role_in(organization_id) IN (''owner'',''administrator''))', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS crm_history_boundary ON public.deal_stage_events;
CREATE POLICY crm_history_boundary ON public.deal_stage_events AS RESTRICTIVE FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_id AND d.organization_id = deal_stage_events.organization_id AND d.deleted_at IS NULL));

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS converted_deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_conversion_email ON contacts (organization_id, lower(btrim(email::text))) WHERE deleted_at IS NULL;

-- Possible company matches only. Legal-suffix matching must never silently merge customers.
CREATE OR REPLACE FUNCTION public.crm_company_match_key(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = public, pg_temp AS $$
  SELECT regexp_replace(regexp_replace(lower(btrim(value)), '[^a-z0-9]+', '', 'g'), '(limited|ltd|incorporated|inc|llc|plc)$', '');
$$;

CREATE OR REPLACE FUNCTION public.crm_convert_lead(
  p_organization_id uuid, p_lead_id uuid,
  p_create_deal boolean DEFAULT false, p_deal_name text DEFAULT NULL,
  p_deal_value numeric DEFAULT NULL, p_expected_close date DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_company_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  lead_row leads%ROWTYPE;
  contact_row contacts%ROWTYPE;
  company_row companies%ROWTYPE;
  deal_row deals%ROWTYPE;
  contact_matches jsonb := '[]';
  company_matches jsonb := '[]';
  exact_company_count integer;
  member uuid;
  already boolean := false;
BEGIN
  member := public.auth_member_id(p_organization_id);
  IF member IS NULL OR public.auth_role_in(p_organization_id) NOT IN ('owner','administrator','manager','sales_staff') THEN
    RAISE EXCEPTION 'CRM conversion is not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_deal_value IS NOT NULL AND (p_deal_value < 0 OR p_deal_value > 999999999999.99 OR p_deal_value::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'Deal value is out of range' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(p_deal_name, '')) > 250 THEN
    RAISE EXCEPTION 'Deal name is too long' USING ERRCODE = '22023';
  END IF;
  -- Serialize conversions within a tenant. This prevents two different leads
  -- with the same identity racing through contact creation. No external worker.
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-convert:' || p_organization_id::text, 0));
  SELECT * INTO lead_row FROM leads WHERE id = p_lead_id AND organization_id = p_organization_id
    AND deleted_at IS NULL AND public.crm_record_visible(organization_id, owner_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002'; END IF;

  IF lead_row.converted_at IS NOT NULL OR lead_row.converted_contact_id IS NOT NULL THEN
    already := true;
    SELECT * INTO contact_row FROM contacts WHERE id = lead_row.converted_contact_id AND organization_id = p_organization_id AND deleted_at IS NULL;
    SELECT * INTO company_row FROM companies WHERE id = contact_row.company_id AND organization_id = p_organization_id AND deleted_at IS NULL;
    SELECT * INTO deal_row FROM deals WHERE id = lead_row.converted_deal_id AND organization_id = p_organization_id AND deleted_at IS NULL;
  ELSE
    IF p_contact_id IS NOT NULL THEN
      SELECT * INTO contact_row FROM contacts WHERE id = p_contact_id AND organization_id = p_organization_id AND deleted_at IS NULL AND is_active FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Selected contact is unavailable' USING ERRCODE = '22023'; END IF;
    ELSE
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'first_name', first_name, 'last_name', last_name, 'email', email, 'company_id', company_id)), '[]')
      INTO contact_matches FROM contacts WHERE organization_id = p_organization_id AND deleted_at IS NULL AND is_active
        AND nullif(btrim(lead_row.email::text), '') IS NOT NULL AND lower(btrim(email::text)) = lower(btrim(lead_row.email::text));
      IF jsonb_array_length(contact_matches) = 1 THEN
        SELECT * INTO contact_row FROM contacts WHERE id = (contact_matches->0->>'id')::uuid FOR UPDATE;
      END IF;
    END IF;

    IF contact_row.company_id IS NOT NULL THEN
      IF p_company_id IS NOT NULL AND p_company_id <> contact_row.company_id THEN
        RAISE EXCEPTION 'The selected contact belongs to another company' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO company_row FROM companies WHERE id = contact_row.company_id AND organization_id = p_organization_id AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'The contact company is unavailable; review the contact first' USING ERRCODE = '22023'; END IF;
    ELSIF p_company_id IS NOT NULL THEN
      SELECT * INTO company_row FROM companies WHERE id = p_company_id AND organization_id = p_organization_id AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Selected company is unavailable' USING ERRCODE = '22023'; END IF;
    ELSIF nullif(btrim(lead_row.company_name), '') IS NOT NULL THEN
      SELECT count(*) INTO exact_company_count FROM companies WHERE organization_id = p_organization_id AND deleted_at IS NULL
        AND lower(btrim(name)) = lower(btrim(lead_row.company_name));
      IF exact_company_count = 1 THEN
        SELECT * INTO company_row FROM companies WHERE organization_id = p_organization_id AND deleted_at IS NULL
          AND lower(btrim(name)) = lower(btrim(lead_row.company_name));
      ELSE
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]') INTO company_matches
        FROM companies WHERE organization_id = p_organization_id AND deleted_at IS NULL
          AND public.crm_company_match_key(name) = public.crm_company_match_key(lead_row.company_name);
      END IF;
    END IF;

    IF jsonb_array_length(contact_matches) > 1 OR jsonb_array_length(company_matches) > 0 THEN
      RETURN jsonb_build_object('conflict', true, 'contacts', CASE WHEN jsonb_array_length(contact_matches) > 1 THEN contact_matches ELSE '[]'::jsonb END, 'companies', company_matches);
    END IF;

    IF company_row.id IS NULL AND nullif(btrim(lead_row.company_name), '') IS NOT NULL THEN
      INSERT INTO companies(organization_id, name, owner_id, notes)
        VALUES (p_organization_id, btrim(lead_row.company_name), coalesce(lead_row.owner_id, member), '') RETURNING * INTO company_row;
    END IF;
    IF contact_row.id IS NULL THEN
      INSERT INTO contacts(organization_id, company_id, first_name, last_name, email, phone, job_title, source, owner_id, notes)
      VALUES (p_organization_id, company_row.id, lead_row.first_name, lead_row.last_name, lead_row.email, lead_row.phone,
        lead_row.job_title, lead_row.source, coalesce(lead_row.owner_id, member), lead_row.notes) RETURNING * INTO contact_row;
    ELSIF contact_row.company_id IS NULL AND company_row.id IS NOT NULL THEN
      UPDATE contacts SET company_id = company_row.id WHERE id = contact_row.id AND organization_id = p_organization_id RETURNING * INTO contact_row;
    END IF;
    IF p_create_deal THEN
      INSERT INTO deals(organization_id, company_id, contact_id, name, stage, value, probability, expected_close, owner_id, notes)
      VALUES (p_organization_id, company_row.id, contact_row.id,
        coalesce(nullif(btrim(p_deal_name), ''), coalesce(nullif(btrim(lead_row.company_name), ''), nullif(btrim(lead_row.first_name || ' ' || lead_row.last_name), ''), 'New') || ' opportunity'),
        'qualification', coalesce(p_deal_value, lead_row.estimated_value), CASE WHEN lead_row.score > 0 THEN lead_row.score ELSE 20 END,
        p_expected_close, coalesce(lead_row.owner_id, member), '') RETURNING * INTO deal_row;
    END IF;
    UPDATE leads SET converted_contact_id = contact_row.id, converted_deal_id = deal_row.id, converted_at = now(), status = 'won'
      WHERE id = lead_row.id AND organization_id = p_organization_id RETURNING * INTO lead_row;
    -- Preserve attribution and existing links; add only missing customer context.
    UPDATE crm_activities SET contact_id = coalesce(contact_id, contact_row.id), company_id = coalesce(company_id, company_row.id)
      WHERE organization_id = p_organization_id AND lead_id = lead_row.id;
    INSERT INTO crm_activities(organization_id, activity_type, subject, body, lead_id, contact_id, company_id, deal_id, member_id)
      VALUES (p_organization_id, 'note', 'Lead converted', 'Lead linked to customer records' || CASE WHEN deal_row.id IS NOT NULL THEN ' and a new opportunity.' ELSE '.' END,
        lead_row.id, contact_row.id, company_row.id, deal_row.id, member);
  END IF;
  RETURN jsonb_build_object('already_converted', already, 'lead', to_jsonb(lead_row),
    'contact', CASE WHEN contact_row.id IS NULL THEN NULL ELSE to_jsonb(contact_row) || jsonb_build_object('company', CASE WHEN company_row.id IS NULL THEN NULL ELSE to_jsonb(company_row) END) END,
    'company', CASE WHEN company_row.id IS NULL THEN NULL ELSE to_jsonb(company_row) END,
    'deal', CASE WHEN deal_row.id IS NULL THEN NULL ELSE to_jsonb(deal_row) || jsonb_build_object('company', CASE WHEN company_row.id IS NULL THEN NULL ELSE to_jsonb(company_row) END, 'contact', to_jsonb(contact_row)) END);
END $$;
REVOKE ALL ON FUNCTION public.crm_convert_lead(uuid, uuid, boolean, text, numeric, date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_convert_lead(uuid, uuid, boolean, text, numeric, date, uuid, uuid) TO authenticated;

-- Reject cross-tenant foreign keys even when using the direct authenticated API.
-- Check changed links only, so historical inactive owners do not block unrelated edits.
CREATE OR REPLACE FUNCTION public.crm_check_relationships()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE field text; target text; linked uuid; old_value jsonb; new_value jsonb; valid boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'CRM records cannot move between organizations' USING ERRCODE = '23514';
  END IF;
  new_value := to_jsonb(NEW);
  old_value := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  FOREACH field IN ARRAY ARRAY['owner_id','member_id','company_id','contact_id','lead_id','deal_id','converted_contact_id','converted_deal_id'] LOOP
    IF new_value->>field IS NULL OR (TG_OP = 'UPDATE' AND new_value->field IS NOT DISTINCT FROM old_value->field) THEN CONTINUE; END IF;
    target := CASE field WHEN 'owner_id' THEN 'organization_members' WHEN 'member_id' THEN 'organization_members'
      WHEN 'company_id' THEN 'companies' WHEN 'contact_id' THEN 'contacts' WHEN 'converted_contact_id' THEN 'contacts'
      WHEN 'lead_id' THEN 'leads' ELSE 'deals' END;
    linked := (new_value->>field)::uuid;
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND organization_id=$2)', target) INTO valid USING linked, NEW.organization_id;
    IF NOT valid THEN RAISE EXCEPTION 'Related record must belong to the same organization' USING ERRCODE = '23514'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_check_relationships() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['leads','deals','companies','contacts','crm_activities'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS crm_relationship_boundary ON public.%I', t);
    EXECUTE format('CREATE TRIGGER crm_relationship_boundary BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.crm_check_relationships()', t);
  END LOOP;
END $$;
