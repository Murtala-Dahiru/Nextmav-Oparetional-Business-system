-- ═══════════════════════════════════════════════════════════════════════════
--  0007 — Reporting views and operational queries
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ⚠  security_invoker = true ON EVERY VIEW. This is not optional.
--
--  A Postgres view executes with the privileges of its OWNER by default, and
--  the owner here is the migration role. A view over a tenant table would
--  therefore read every organization's rows and hand them to whoever queried
--  the view — RLS on the underlying table is bypassed entirely. It is the
--  single most common way a carefully-built multi-tenant schema leaks.
--
--  `security_invoker = true` (Postgres 15+, which Supabase runs) makes the
--  view execute as the caller, so the policies in 0005 apply normally.
--
--  Any view added later must set it too.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  Directory
-- ───────────────────────────────────────────────────────────────────────────

/** Members with their profile, department and reporting line resolved. */
-- Dropped first rather than replaced. `db:apply` re-runs every migration, and
-- 0012 extends this view with four more columns — so on the second run this
-- statement would be replacing a 22-column view with an 18-column one, which
-- Postgres refuses with "cannot drop columns from view". Recreating from
-- scratch keeps the chain re-runnable; 0012 then re-adds its columns as it did
-- the first time. Nothing depends on this view, so the drop is contained.
DROP VIEW IF EXISTS public.v_org_directory;

CREATE VIEW public.v_org_directory
WITH (security_invoker = true) AS
SELECT
  om.id                AS member_id,
  om.organization_id,
  om.role,
  om.employee_number,
  om.employment_type,
  om.hired_on,
  om.is_active,
  p.id                 AS user_id,
  p.email,
  p.full_name,
  p.avatar_url,
  p.job_title,
  p.phone,
  p.last_seen_at,
  d.id                 AS department_id,
  d.name               AS department_name,
  mgr_p.full_name      AS manager_name,
  om.manager_id
FROM organization_members om
JOIN profiles p              ON p.id = om.user_id
LEFT JOIN departments d      ON d.id = om.department_id
LEFT JOIN organization_members mgr ON mgr.id = om.manager_id
LEFT JOIN profiles mgr_p     ON mgr_p.id = mgr.user_id;

COMMENT ON VIEW public.v_org_directory IS
  'Employee directory. Respects RLS via security_invoker.';

-- ───────────────────────────────────────────────────────────────────────────
--  Attendance reporting
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Per-member attendance rollup by month.
 *
 * Punctuality is measured against days actually attended rather than days in
 * the period, so approved leave never counts against someone — the same rule
 * the application applies, expressed once here so reports and screens agree.
 */
CREATE OR REPLACE VIEW public.v_attendance_summary
WITH (security_invoker = true) AS
SELECT
  ar.organization_id,
  ar.member_id,
  date_trunc('month', ar.work_date)::date          AS period,
  count(*)                                          AS days_recorded,
  count(*) FILTER (WHERE ar.status = 'present')     AS days_present,
  count(*) FILTER (WHERE ar.status = 'late')        AS days_late,
  count(*) FILTER (WHERE ar.status = 'remote')      AS days_remote,
  count(*) FILTER (WHERE ar.status = 'absent')      AS days_absent,
  count(*) FILTER (WHERE ar.status = 'on_leave')    AS days_on_leave,
  count(*) FILTER (WHERE ar.status = 'half_day')    AS days_half,
  COALESCE(sum(ar.worked_minutes), 0)               AS total_minutes,
  COALESCE(sum(ar.late_minutes), 0)                 AS total_late_minutes,
  round(COALESCE(sum(ar.worked_minutes), 0) / 60.0, 2) AS total_hours,
  count(*) FILTER (WHERE ar.status IN ('present','late','remote','half_day')) AS days_attended,
  CASE
    WHEN count(*) FILTER (WHERE ar.status IN ('present','late','remote','half_day')) = 0 THEN 0
    ELSE round(
      100.0 * count(*) FILTER (WHERE ar.status IN ('present','remote'))
      / count(*) FILTER (WHERE ar.status IN ('present','late','remote','half_day')), 1)
  END AS punctuality_rate
FROM attendance_records ar
GROUP BY ar.organization_id, ar.member_id, date_trunc('month', ar.work_date);

/** Who is currently clocked in — the "in the office now" query. */
CREATE OR REPLACE VIEW public.v_attendance_today
WITH (security_invoker = true) AS
SELECT
  ar.organization_id,
  ar.member_id,
  p.full_name,
  d.name AS department_name,
  ar.work_date,
  ar.checked_in_at,
  ar.checked_out_at,
  ar.status,
  ar.late_minutes,
  ar.worked_minutes,
  ar.is_remote,
  (ar.checked_in_at IS NOT NULL AND ar.checked_out_at IS NULL) AS is_clocked_in
FROM attendance_records ar
JOIN organization_members om ON om.id = ar.member_id
JOIN profiles p              ON p.id = om.user_id
LEFT JOIN departments d      ON d.id = om.department_id
WHERE ar.work_date = current_date;

-- ───────────────────────────────────────────────────────────────────────────
--  CRM
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Pipeline by stage, with probability-weighted value.
 *
 * Weighting is what makes a pipeline forecastable rather than a sum of
 * optimism, so it belongs in the report rather than in each caller.
 */
CREATE OR REPLACE VIEW public.v_pipeline_summary
WITH (security_invoker = true) AS
SELECT
  d.organization_id,
  d.stage,
  count(*)                                        AS deal_count,
  COALESCE(sum(d.value), 0)                       AS total_value,
  COALESCE(sum(d.value * d.probability / 100.0), 0) AS weighted_value,
  COALESCE(avg(d.probability), 0)                 AS avg_probability
FROM deals d
WHERE d.deleted_at IS NULL
GROUP BY d.organization_id, d.stage;

/** Sales performance per owner. */
CREATE OR REPLACE VIEW public.v_sales_performance
WITH (security_invoker = true) AS
SELECT
  d.organization_id,
  d.owner_id,
  p.full_name AS owner_name,
  count(*)                                                          AS total_deals,
  count(*) FILTER (WHERE d.stage = 'closed_won')                    AS won_deals,
  count(*) FILTER (WHERE d.stage = 'closed_lost')                   AS lost_deals,
  COALESCE(sum(d.value) FILTER (WHERE d.stage = 'closed_won'), 0)   AS won_value,
  COALESCE(sum(d.value) FILTER (WHERE d.stage NOT IN ('closed_won','closed_lost')), 0) AS open_value,
  CASE
    WHEN count(*) FILTER (WHERE d.stage IN ('closed_won','closed_lost')) = 0 THEN 0
    ELSE round(100.0 * count(*) FILTER (WHERE d.stage = 'closed_won')
             / count(*) FILTER (WHERE d.stage IN ('closed_won','closed_lost')), 1)
  END AS win_rate
FROM deals d
LEFT JOIN organization_members om ON om.id = d.owner_id
LEFT JOIN profiles p              ON p.id = om.user_id
WHERE d.deleted_at IS NULL
GROUP BY d.organization_id, d.owner_id, p.full_name;

-- ───────────────────────────────────────────────────────────────────────────
--  Projects
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Project health.
 *
 * `is_at_risk` encodes the judgement a project manager makes by eye: the
 * deadline is close and the work is not proportionally done. Computing it here
 * means every surface flags the same projects.
 */
-- Dropped first rather than replaced, for the same reason as v_org_directory
-- above: `db:apply` re-runs every migration, and 0015 extends this view with
-- milestone columns. On the second run this statement would be replacing a
-- wider view with a narrower one, which Postgres refuses with "cannot drop
-- columns from view". Recreating from scratch keeps the chain re-runnable;
-- 0015 then re-applies its own definition afterwards.
-- CASCADE because a later migration (0016) builds v_client_portal_projects
-- on top of this view. Without it, re-running the migration chain from the
-- start fails here with "cannot drop view ... because other objects depend on
-- it", which breaks the re-runnability the whole apply script relies on. The
-- dependent view is recreated by 0016 later in the same run.
DROP VIEW IF EXISTS public.v_project_health CASCADE;

CREATE VIEW public.v_project_health
WITH (security_invoker = true) AS
SELECT
  pr.organization_id,
  pr.id                AS project_id,
  pr.name,
  pr.status,
  pr.priority,
  pr.budget,
  pr.start_date,
  pr.end_date,
  count(t.id)                                      AS total_tasks,
  count(t.id) FILTER (WHERE t.status = 'done')     AS completed_tasks,
  count(t.id) FILTER (WHERE t.status = 'blocked')  AS blocked_tasks,
  count(t.id) FILTER (WHERE t.status <> 'done' AND t.due_date < current_date) AS overdue_tasks,
  CASE WHEN count(t.id) = 0 THEN 0
       ELSE round(100.0 * count(t.id) FILTER (WHERE t.status = 'done') / count(t.id), 1)
  END AS progress_pct,
  (pr.end_date - current_date) AS days_remaining,
  COALESCE(sum(te.minutes), 0) / 60.0 AS logged_hours,
  CASE
    WHEN pr.status NOT IN ('active','planning') THEN false
    WHEN pr.end_date IS NULL THEN false
    WHEN pr.end_date - current_date <= 14
     AND (count(t.id) = 0
          OR 100.0 * count(t.id) FILTER (WHERE t.status = 'done') / count(t.id) < 75)
      THEN true
    ELSE false
  END AS is_at_risk
FROM projects pr
LEFT JOIN tasks t        ON t.project_id = pr.id AND t.deleted_at IS NULL
LEFT JOIN time_entries te ON te.project_id = pr.id
WHERE pr.deleted_at IS NULL
GROUP BY pr.organization_id, pr.id, pr.name, pr.status, pr.priority,
         pr.budget, pr.start_date, pr.end_date;

/** Who is committed to what, for capacity planning. */
CREATE OR REPLACE VIEW public.v_resource_allocation
WITH (security_invoker = true) AS
SELECT
  pm.member_id,
  pr.organization_id,
  p.full_name,
  count(DISTINCT pr.id)                        AS active_projects,
  COALESCE(sum(pm.allocation_pct), 0)          AS total_allocation_pct,
  count(t.id) FILTER (WHERE t.status <> 'done') AS open_tasks
FROM project_members pm
JOIN projects pr             ON pr.id = pm.project_id AND pr.status = 'active' AND pr.deleted_at IS NULL
JOIN organization_members om ON om.id = pm.member_id
JOIN profiles p              ON p.id = om.user_id
LEFT JOIN tasks t            ON t.assignee_id = pm.member_id AND t.deleted_at IS NULL
GROUP BY pm.member_id, pr.organization_id, p.full_name;

-- ───────────────────────────────────────────────────────────────────────────
--  Finance
-- ───────────────────────────────────────────────────────────────────────────

/** Revenue, spend and outstanding receivables by month. */
CREATE OR REPLACE VIEW public.v_finance_monthly
WITH (security_invoker = true) AS
WITH months AS (
  SELECT organization_id, date_trunc('month', issue_date)::date AS period,
         sum(total) FILTER (WHERE status = 'paid')       AS revenue,
         sum(total) FILTER (WHERE status <> 'cancelled') AS invoiced,
         sum(total - amount_paid) FILTER (
           WHERE status NOT IN ('paid','cancelled','draft')) AS outstanding
  FROM invoices WHERE deleted_at IS NULL
  GROUP BY organization_id, date_trunc('month', issue_date)
),
spend AS (
  SELECT organization_id, date_trunc('month', expense_date)::date AS period,
         sum(amount) FILTER (WHERE status IN ('approved','reimbursed')) AS expenses
  FROM expenses WHERE deleted_at IS NULL
  GROUP BY organization_id, date_trunc('month', expense_date)
)
SELECT
  COALESCE(m.organization_id, s.organization_id) AS organization_id,
  COALESCE(m.period, s.period)                   AS period,
  COALESCE(m.revenue, 0)                         AS revenue,
  COALESCE(m.invoiced, 0)                        AS invoiced,
  COALESCE(m.outstanding, 0)                     AS outstanding,
  COALESCE(s.expenses, 0)                        AS expenses,
  COALESCE(m.revenue, 0) - COALESCE(s.expenses, 0) AS net
FROM months m
FULL OUTER JOIN spend s
  ON s.organization_id = m.organization_id AND s.period = m.period;

/** Receivables ageing — the report finance actually chases people with. */
CREATE OR REPLACE VIEW public.v_receivables_ageing
WITH (security_invoker = true) AS
SELECT
  i.organization_id,
  i.id AS invoice_id,
  i.invoice_number,
  c.name AS company_name,
  i.total,
  i.amount_paid,
  (i.total - i.amount_paid) AS balance,
  i.due_date,
  (current_date - i.due_date) AS days_overdue,
  CASE
    WHEN i.due_date >= current_date          THEN 'current'
    WHEN current_date - i.due_date <= 30     THEN '1-30'
    WHEN current_date - i.due_date <= 60     THEN '31-60'
    WHEN current_date - i.due_date <= 90     THEN '61-90'
    ELSE '90+'
  END AS ageing_bucket
FROM invoices i
LEFT JOIN companies c ON c.id = i.company_id
WHERE i.deleted_at IS NULL
  AND i.status NOT IN ('paid','cancelled','draft');

-- ───────────────────────────────────────────────────────────────────────────
--  Support
-- ───────────────────────────────────────────────────────────────────────────

/** SLA performance, including breaches still open. */
CREATE OR REPLACE VIEW public.v_support_sla
WITH (security_invoker = true) AS
SELECT
  t.organization_id,
  t.assignee_id,
  p.full_name AS assignee_name,
  count(*)                                                       AS total_tickets,
  count(*) FILTER (WHERE t.status NOT IN ('resolved','closed'))   AS open_tickets,
  count(*) FILTER (WHERE t.resolved_at IS NOT NULL)               AS resolved_tickets,
  count(*) FILTER (WHERE t.resolved_at IS NULL AND t.due_at < now()) AS breached_open,
  count(*) FILTER (WHERE t.resolved_at IS NOT NULL AND t.resolved_at > t.due_at) AS breached_resolved,
  round(avg(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0)
        FILTER (WHERE t.resolved_at IS NOT NULL)::numeric, 1) AS avg_resolution_hours,
  round(avg(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 3600.0)
        FILTER (WHERE t.first_response_at IS NOT NULL)::numeric, 1) AS avg_first_response_hours
FROM support_tickets t
LEFT JOIN organization_members om ON om.id = t.assignee_id
LEFT JOIN profiles p              ON p.id = om.user_id
WHERE t.deleted_at IS NULL
GROUP BY t.organization_id, t.assignee_id, p.full_name;

-- ───────────────────────────────────────────────────────────────────────────
--  Inventory
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Reorder report.
 *
 * `suggested_order_qty` nets off what is already on order, so a buyer is not
 * told to reorder something that is already in transit — the difference
 * between a report that gets used and one that gets ignored.
 */
CREATE OR REPLACE VIEW public.v_inventory_alerts
WITH (security_invoker = true) AS
SELECT
  pr.organization_id,
  pr.id AS product_id,
  pr.sku,
  pr.name,
  pr.stock,
  pr.reorder_level,
  pr.unit,
  pr.cost,
  w.name AS warehouse_name,
  s.name AS supplier_name,
  s.lead_time_days,
  COALESCE(inbound.qty, 0) AS incoming_qty,
  GREATEST(0, pr.reorder_level - pr.stock) AS shortfall,
  GREATEST(0, pr.reorder_level - pr.stock - COALESCE(inbound.qty, 0)) AS suggested_order_qty,
  round(GREATEST(0, pr.reorder_level - pr.stock - COALESCE(inbound.qty, 0)) * pr.cost, 2) AS estimated_cost,
  CASE
    WHEN pr.stock <= 0 THEN 'out_of_stock'
    WHEN COALESCE(inbound.qty, 0) >= GREATEST(0, pr.reorder_level - pr.stock) THEN 'covered'
    ELSE 'low'
  END AS severity
FROM products pr
LEFT JOIN warehouses w ON w.id = pr.warehouse_id
LEFT JOIN suppliers  s ON s.id = pr.supplier_id
LEFT JOIN (
  SELECT poi.product_id, sum(poi.quantity - poi.received_quantity) AS qty
  FROM purchase_order_items poi
  JOIN purchase_orders po ON po.id = poi.order_id
  WHERE po.status IN ('submitted','approved','partially_received')
  GROUP BY poi.product_id
) inbound ON inbound.product_id = pr.id
WHERE pr.is_active = true
  AND pr.deleted_at IS NULL
  AND pr.stock <= pr.reorder_level;

/** Stock valuation, for the balance sheet. */
CREATE OR REPLACE VIEW public.v_inventory_valuation
WITH (security_invoker = true) AS
SELECT
  pr.organization_id,
  pr.warehouse_id,
  w.name AS warehouse_name,
  count(*)                                  AS product_count,
  COALESCE(sum(pr.stock), 0)                AS total_units,
  COALESCE(sum(pr.stock * pr.cost), 0)      AS stock_value_at_cost,
  COALESCE(sum(pr.stock * pr.price), 0)     AS stock_value_at_price
FROM products pr
LEFT JOIN warehouses w ON w.id = pr.warehouse_id
WHERE pr.is_active = true AND pr.deleted_at IS NULL
GROUP BY pr.organization_id, pr.warehouse_id, w.name;

-- ───────────────────────────────────────────────────────────────────────────
--  Executive dashboard
-- ───────────────────────────────────────────────────────────────────────────

/**
 * One row per organization, for the command-centre header.
 *
 * Scalar subqueries rather than a chain of joins: joining eight fact tables
 * multiplies rows and produces wrong counts unless every join is grouped
 * defensively. This is slower to write and correct by construction.
 */
CREATE OR REPLACE VIEW public.v_dashboard_stats
WITH (security_invoker = true) AS
SELECT
  o.id AS organization_id,
  (SELECT count(*) FROM organization_members om
     WHERE om.organization_id = o.id AND om.is_active) AS headcount,
  (SELECT count(*) FROM departments d
     WHERE d.organization_id = o.id AND d.deleted_at IS NULL) AS department_count,
  (SELECT count(*) FROM profiles p
     JOIN organization_members om2 ON om2.user_id = p.id
     WHERE om2.organization_id = o.id AND p.last_seen_at > now() - interval '15 minutes') AS online_now,
  (SELECT count(*) FROM projects pr
     WHERE pr.organization_id = o.id AND pr.status = 'active' AND pr.deleted_at IS NULL) AS active_projects,
  (SELECT count(*) FROM tasks t
     WHERE t.organization_id = o.id AND t.status <> 'done' AND t.deleted_at IS NULL) AS open_tasks,
  (SELECT count(*) FROM tasks t
     WHERE t.organization_id = o.id AND t.status <> 'done'
       AND t.due_date < current_date AND t.deleted_at IS NULL) AS overdue_tasks,
  (SELECT count(*) FROM support_tickets st
     WHERE st.organization_id = o.id AND st.status NOT IN ('resolved','closed')
       AND st.deleted_at IS NULL) AS open_tickets,
  (SELECT count(*) FROM support_tickets st
     WHERE st.organization_id = o.id AND st.resolved_at IS NULL
       AND st.due_at < now() AND st.deleted_at IS NULL) AS breached_tickets,
  (SELECT COALESCE(sum(d.value * d.probability / 100.0), 0) FROM deals d
     WHERE d.organization_id = o.id
       AND d.stage NOT IN ('closed_won','closed_lost') AND d.deleted_at IS NULL) AS weighted_pipeline,
  (SELECT COALESCE(sum(d.value), 0) FROM deals d
     WHERE d.organization_id = o.id
       AND d.stage NOT IN ('closed_won','closed_lost') AND d.deleted_at IS NULL) AS open_pipeline,
  (SELECT COALESCE(sum(i.total), 0) FROM invoices i
     WHERE i.organization_id = o.id AND i.status = 'paid' AND i.deleted_at IS NULL) AS revenue_collected,
  (SELECT COALESCE(sum(i.total - i.amount_paid), 0) FROM invoices i
     WHERE i.organization_id = o.id
       AND i.status NOT IN ('paid','cancelled','draft') AND i.deleted_at IS NULL) AS receivables,
  (SELECT count(*) FROM leave_requests lr
     WHERE lr.organization_id = o.id AND lr.status = 'pending') AS pending_leave,
  (SELECT count(*) FROM expenses e
     WHERE e.organization_id = o.id AND e.status = 'pending' AND e.deleted_at IS NULL) AS pending_expenses,
  (SELECT count(*) FROM products pr
     WHERE pr.organization_id = o.id AND pr.is_active
       AND pr.deleted_at IS NULL AND pr.stock <= pr.reorder_level) AS low_stock_products
FROM organizations o
WHERE o.deleted_at IS NULL;

COMMENT ON VIEW public.v_dashboard_stats IS
  'One row per organization for the executive dashboard. security_invoker keeps it tenant-scoped.';

-- ───────────────────────────────────────────────────────────────────────────
--  Grants
-- ───────────────────────────────────────────────────────────────────────────
--
--  Safe because every view is security_invoker: the caller still only sees
--  rows their own RLS policies permit.

GRANT SELECT ON
  public.v_org_directory,
  public.v_attendance_summary,
  public.v_attendance_today,
  public.v_pipeline_summary,
  public.v_sales_performance,
  public.v_project_health,
  public.v_resource_allocation,
  public.v_finance_monthly,
  public.v_receivables_ageing,
  public.v_support_sla,
  public.v_inventory_alerts,
  public.v_inventory_valuation,
  public.v_dashboard_stats
TO authenticated;
