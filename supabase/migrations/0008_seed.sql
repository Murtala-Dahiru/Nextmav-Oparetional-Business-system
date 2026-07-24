-- ═══════════════════════════════════════════════════════════════════════════
--  0008 — Reference data and optional demo seed
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Reference data is inserted unconditionally: it is configuration, not
--  content, and the application misbehaves without it.
--
--  Demo data is NOT. It is exposed as a function you call deliberately:
--
--      SELECT public.seed_demo_organization('Acme Inc');
--
--  A migration that inserts fake customers on every deploy will eventually run
--  against production, and "who is Jane Doe and why is she in our CRM" is a
--  bad first impression. Opt-in also means this file is safe to keep in the
--  migration chain forever.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  Organization settings
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_settings (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key             text NOT NULL,
  value           jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, key)
);

ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_settings_select ON org_settings;
CREATE POLICY org_settings_select ON org_settings FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids()));

DROP POLICY IF EXISTS org_settings_write ON org_settings;
CREATE POLICY org_settings_write ON org_settings FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

/**
 * Defaults applied to every new organization.
 *
 * Seeded by trigger rather than expected from the client, so an organization
 * created through any path — the RPC, the SQL editor, a future admin tool —
 * is immediately usable.
 */
CREATE OR REPLACE FUNCTION public.seed_new_organization()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d_general uuid;
BEGIN
  INSERT INTO org_settings (organization_id, key, value) VALUES
    (NEW.id, 'leave_entitlement',
      '{"vacation": 25, "sick": 10, "personal": 3}'::jsonb),
    (NEW.id, 'invoice_defaults',
      '{"payment_terms_days": 30, "tax_rate": 0}'::jsonb),
    (NEW.id, 'notifications',
      '{"email_on_mention": true, "email_on_assignment": true}'::jsonb)
  ON CONFLICT DO NOTHING;

  -- Every organization needs at least one department, or the first employee
  -- cannot be filed anywhere.
  INSERT INTO departments (organization_id, name, description)
  VALUES (NEW.id, 'General', 'Default department')
  ON CONFLICT (organization_id, name) DO NOTHING
  RETURNING id INTO d_general;

  -- A general channel gives the communication module somewhere to start.
  INSERT INTO channels (organization_id, name, description, type)
  VALUES (NEW.id, 'general', 'Company-wide discussion', 'public')
  ON CONFLICT DO NOTHING;

  INSERT INTO workspace_spaces (organization_id, name, description, visibility)
  VALUES (NEW.id, 'Company Wiki', 'Shared knowledge base', 'organization')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_new_organization ON organizations;
CREATE TRIGGER trg_seed_new_organization
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_new_organization();

-- ───────────────────────────────────────────────────────────────────────────
--  Demo data (opt-in)
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Populate an organization with representative demo data.
 *
 * Call it explicitly after signing up:
 *
 *     SELECT public.seed_demo_organization('Acme Inc');
 *
 * Creates the organization with the caller as owner, then fills every module
 * with enough interlinked data to exercise real workflows — deals that belong
 * to companies, tasks that belong to projects, invoices that belong to
 * clients. Isolated rows would make the screens look populated while every
 * cross-module view stayed empty.
 */
CREATE OR REPLACE FUNCTION public.seed_demo_organization(org_name text DEFAULT 'Demo Company')
RETURNS organizations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o          organizations;
  owner_m    uuid;
  d_eng      uuid;
  d_sales    uuid;
  c_acme     uuid;
  c_globex   uuid;
  ct_1       uuid;
  proj_1     uuid;
  proj_2     uuid;
  wh_1       uuid;
  sup_1      uuid;
  prod_1     uuid;
  prod_2     uuid;
  inv_1      uuid;
  i          int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  o := public.create_organization(org_name);
  owner_m := public.auth_member_id(o.id);

  -- ── Departments ──
  INSERT INTO departments (organization_id, name, description)
  VALUES (o.id, 'Engineering', 'Product development')
  ON CONFLICT (organization_id, name) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO d_eng;

  INSERT INTO departments (organization_id, name, description)
  VALUES (o.id, 'Sales', 'Revenue and customer acquisition')
  ON CONFLICT (organization_id, name) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO d_sales;

  UPDATE organization_members SET department_id = d_eng WHERE id = owner_m;

  -- ── CRM ──
  INSERT INTO companies (organization_id, name, industry, city, country, employee_count, annual_revenue, owner_id)
  VALUES (o.id, 'Acme Corporation', 'Manufacturing', 'Austin', 'United States', 450, 24000000, owner_m)
  RETURNING id INTO c_acme;

  INSERT INTO companies (organization_id, name, industry, city, country, employee_count, annual_revenue, owner_id)
  VALUES (o.id, 'Globex Industries', 'Logistics', 'Rotterdam', 'Netherlands', 1200, 88000000, owner_m)
  RETURNING id INTO c_globex;

  INSERT INTO contacts (organization_id, company_id, first_name, last_name, email, job_title, owner_id)
  VALUES (o.id, c_acme, 'Rita', 'Vale', 'rita.vale@acme.test', 'Head of Operations', owner_m)
  RETURNING id INTO ct_1;

  INSERT INTO contacts (organization_id, company_id, first_name, last_name, email, job_title, owner_id)
  VALUES (o.id, c_globex, 'Tomas', 'Berg', 'tomas.berg@globex.test', 'Procurement Director', owner_m);

  INSERT INTO leads (organization_id, first_name, last_name, email, company_name, status, score, estimated_value, owner_id)
  VALUES
    (o.id, 'Priya', 'Raman', 'priya@northwind.test', 'Northwind Trading', 'qualified', 82, 45000, owner_m),
    (o.id, 'Marcus', 'Webb',  'marcus@kestrel.test',  'Kestrel Systems',   'contacted', 54, 18000, owner_m),
    (o.id, 'Ana',    'Silva', 'ana@meridian.test',    'Meridian Health',   'proposal',  91, 120000, owner_m);

  INSERT INTO deals (organization_id, name, company_id, contact_id, stage, value, probability, expected_close, owner_id)
  VALUES
    (o.id, 'Acme — platform rollout',     c_acme,   ct_1, 'negotiation', 78000,  70, current_date + 21, owner_m),
    (o.id, 'Globex — logistics module',   c_globex, NULL, 'proposal',    145000, 45, current_date + 45, owner_m),
    (o.id, 'Northwind — pilot',           NULL,     NULL, 'qualification',32000, 25, current_date + 60, owner_m);

  INSERT INTO crm_activities (organization_id, activity_type, subject, body, company_id, member_id)
  VALUES (o.id, 'call', 'Discovery call', 'Walked through requirements and timeline.', c_acme, owner_m);

  -- ── Projects ──
  INSERT INTO projects (organization_id, name, description, status, priority, department_id, owner_id, client_company_id, budget, start_date, end_date)
  VALUES (o.id, 'Platform Rollout', 'Deploy the platform for Acme', 'active', 'high',
          d_eng, owner_m, c_acme, 120000, current_date - 20, current_date + 40)
  RETURNING id INTO proj_1;

  INSERT INTO projects (organization_id, name, description, status, priority, department_id, owner_id, budget, start_date, end_date)
  VALUES (o.id, 'Website Redesign', 'Refresh the marketing site', 'active', 'medium',
          d_sales, owner_m, 35000, current_date - 10, current_date + 12)
  RETURNING id INTO proj_2;

  INSERT INTO project_members (project_id, member_id, role) VALUES (proj_1, owner_m, 'lead');
  INSERT INTO project_members (project_id, member_id, role) VALUES (proj_2, owner_m, 'lead');

  INSERT INTO milestones (organization_id, project_id, name, due_date, sort_order)
  VALUES (o.id, proj_1, 'Phase 1 — Discovery', current_date + 5, 1),
         (o.id, proj_1, 'Phase 2 — Build',     current_date + 30, 2);

  -- A spread of statuses and due dates, so project health and the overdue
  -- counters have something real to report.
  FOR i IN 1..8 LOOP
    INSERT INTO tasks (organization_id, project_id, title, description, status, priority, assignee_id, reporter_id, due_date, estimated_hours, sort_order)
    VALUES (
      o.id,
      CASE WHEN i <= 5 THEN proj_1 ELSE proj_2 END,
      (ARRAY['Requirements workshop','Data model review','API contract','Auth integration',
             'Migration dry run','Homepage copy','Design review','Accessibility audit'])[i],
      'Seeded demo task.',
      (ARRAY['done','done','in_progress','in_progress','todo','todo','review','blocked'])[i]::task_status,
      (ARRAY['high','medium','high','critical','medium','low','medium','high'])[i]::priority_level,
      owner_m, owner_m,
      current_date + (i - 3),
      (ARRAY[8,12,16,24,10,6,4,8])[i],
      i
    );
  END LOOP;

  INSERT INTO time_entries (organization_id, project_id, member_id, minutes, entry_date, description, is_billable)
  VALUES (o.id, proj_1, owner_m, 240, current_date - 1, 'Discovery workshop', true),
         (o.id, proj_1, owner_m, 180, current_date - 2, 'Data model review',  true);

  -- ── Finance ──
  INSERT INTO invoices (organization_id, company_id, contact_id, project_id, status, issue_date, due_date, tax_rate, owner_id)
  VALUES (o.id, c_acme, ct_1, proj_1, 'sent', current_date - 20, current_date - 5, 10, owner_m)
  RETURNING id INTO inv_1;

  -- Totals are computed by the recalculation trigger, not set here.
  INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, sort_order)
  VALUES (inv_1, 'Implementation services', 40, 150, 1),
         (inv_1, 'Licence — annual',         1, 12000, 2);

  INSERT INTO invoices (organization_id, company_id, status, issue_date, due_date, tax_rate, owner_id)
  VALUES (o.id, c_globex, 'draft', current_date, current_date + 30, 10, owner_m);

  INSERT INTO expenses (organization_id, title, amount, category, vendor, expense_date, status, submitted_by, department_id)
  VALUES
    (o.id, 'Cloud hosting — monthly', 840.00,  'software', 'AWS',        current_date - 8, 'pending',  owner_m, d_eng),
    (o.id, 'Team offsite',            2450.00, 'travel',   'Various',    current_date - 15,'pending',  owner_m, d_eng);

  -- ── Inventory ──
  INSERT INTO warehouses (organization_id, name, location, capacity)
  VALUES (o.id, 'Main Warehouse', 'Austin, TX', 10000)
  ON CONFLICT (organization_id, name) DO UPDATE SET location = EXCLUDED.location
  RETURNING id INTO wh_1;

  INSERT INTO suppliers (organization_id, name, contact_name, email, lead_time_days, city, country)
  VALUES (o.id, 'Globex Components', 'Rita Vale', 'orders@globex.test', 14, 'Rotterdam', 'Netherlands')
  ON CONFLICT (organization_id, name) DO UPDATE SET email = EXCLUDED.email
  RETURNING id INTO sup_1;

  INSERT INTO products (organization_id, sku, name, category, unit, price, cost, reorder_level, warehouse_id, supplier_id)
  VALUES (o.id, 'HW-1001', 'Edge Gateway', 'Hardware', 'unit', 890, 410, 25, wh_1, sup_1)
  RETURNING id INTO prod_1;

  INSERT INTO products (organization_id, sku, name, category, unit, price, cost, reorder_level, warehouse_id, supplier_id)
  VALUES (o.id, 'HW-1002', 'Sensor Module', 'Hardware', 'unit', 145, 62, 100, wh_1, sup_1)
  RETURNING id INTO prod_2;

  -- Stock arrives through the ledger, so balances and history agree from the
  -- first row rather than being back-filled.
  PERFORM public.record_stock_movement(o.id, prod_1, 60,  'receipt', 'Opening stock', 'SEED');
  PERFORM public.record_stock_movement(o.id, prod_2, 40,  'receipt', 'Opening stock', 'SEED');
  PERFORM public.record_stock_movement(o.id, prod_1, -12, 'issue',   'Customer shipment', 'SEED');
  -- prod_2 is left at 40 against a reorder level of 100, so the reorder report
  -- has a genuine alert to show.

  -- ── Support ──
  INSERT INTO support_tickets (organization_id, subject, description, status, priority, category, requester_id, assignee_id)
  VALUES
    (o.id, 'Gateway drops connection overnight', 'Reported by Acme operations team.', 'open', 'high', 'Hardware', owner_m, owner_m),
    (o.id, 'Invoice PDF missing tax line',       'Finance flagged on INV-000001.',    'in_progress', 'medium', 'Billing', owner_m, owner_m);

  INSERT INTO kb_articles (organization_id, title, body, category, is_published, author_id)
  VALUES (o.id, 'Resetting an Edge Gateway',
          'Hold the reset button for ten seconds until the status light blinks amber.',
          'Hardware', true, owner_m);

  -- ── Calendar ──
  INSERT INTO calendar_events (organization_id, title, description, starts_at, ends_at, location, created_by)
  VALUES
    (o.id, 'Weekly standup', 'Team sync',
     date_trunc('day', now()) + interval '10 hours',
     date_trunc('day', now()) + interval '10 hours 30 minutes', 'Room A', owner_m),
    (o.id, 'Acme review', 'Rollout progress review',
     date_trunc('day', now()) + interval '2 days 14 hours',
     date_trunc('day', now()) + interval '2 days 15 hours', 'Zoom', owner_m);

  -- ── Workspace ──
  INSERT INTO workspace_pages (organization_id, title, content, created_by, last_edited_by)
  VALUES (o.id, 'Engineering Standards',
          'Code review, branching and release conventions.', owner_m, owner_m),
         (o.id, 'Onboarding Guide',
          'What to do in your first week.', owner_m, owner_m);

  RETURN o;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_demo_organization(text) TO authenticated;

COMMENT ON FUNCTION public.seed_demo_organization(text) IS
  'Opt-in demo data. Never called automatically — run it deliberately after signup.';
