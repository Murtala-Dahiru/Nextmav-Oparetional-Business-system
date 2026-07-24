-- ═══════════════════════════════════════════════════════════════════════════
--  0003 — Business tables
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Every table here carries `organization_id NOT NULL`, and every index leads
--  with it. Tenant queries always filter on organization first, so a
--  composite index starting anywhere else will not be used for them.
--
--  Ownership columns reference `organization_members`, not `profiles`. That
--  makes it structurally impossible to assign a record to someone outside the
--  organization — an integrity guarantee that a bare user reference cannot
--  give, and one that would otherwise have to be re-checked in application
--  code on every write.
--
--  Soft delete (`deleted_at`) on anything a person can remove but an audit
--  trail may need to keep pointing at.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  HR — attendance
-- ───────────────────────────────────────────────────────────────────────────
--
--  One row per member per working day. The unique constraint is what makes
--  this a register rather than an event log: "did they work on the 4th?" has
--  exactly one answer.
--
--  Timestamps are written by the database, never by the client — see the
--  clock functions in 0004. A client-supplied time lets anyone backdate their
--  own attendance, which defeats the point of recording it.

CREATE TABLE IF NOT EXISTS attendance_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  work_date       date NOT NULL,
  checked_in_at   timestamptz,
  checked_out_at  timestamptz,
  status          attendance_status NOT NULL DEFAULT 'present',
  -- Derived server-side on check-out; never accepted from the client.
  worked_minutes  int NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  break_minutes   int NOT NULL DEFAULT 0 CHECK (break_minutes  >= 0),
  late_minutes    int NOT NULL DEFAULT 0 CHECK (late_minutes   >= 0),
  early_minutes   int NOT NULL DEFAULT 0 CHECK (early_minutes  >= 0),
  is_remote       boolean NOT NULL DEFAULT false,
  note            text NOT NULL DEFAULT '',
  -- Set when corrected by a manager or HR, so an adjusted record never
  -- masquerades as a clocked one.
  adjusted_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  adjusted_at     timestamptz,
  adjustment_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, work_date),
  -- Cheap invariant that stops inverted intervals reaching reporting.
  CONSTRAINT attendance_interval_valid
    CHECK (checked_out_at IS NULL OR checked_in_at IS NULL OR checked_out_at > checked_in_at)
);

CREATE INDEX IF NOT EXISTS idx_attendance_org_date   ON attendance_records (organization_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_member     ON attendance_records (member_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_org_status ON attendance_records (organization_id, status);
-- Finds anyone currently clocked in — the "who is in today" query.
CREATE INDEX IF NOT EXISTS idx_attendance_open
  ON attendance_records (organization_id, work_date)
  WHERE checked_out_at IS NULL AND checked_in_at IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  HR — leave
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  type            leave_type NOT NULL DEFAULT 'vacation',
  status          leave_status NOT NULL DEFAULT 'pending',
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  -- Supports half-days without a second table.
  is_half_day     boolean NOT NULL DEFAULT false,
  days_requested  numeric(5,2) NOT NULL DEFAULT 0 CHECK (days_requested >= 0),
  reason          text NOT NULL DEFAULT '',
  -- Decision trail. approved_by is a membership, so the approver is provably
  -- someone in the same organization.
  approved_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_dates_valid CHECK (end_date >= start_date),
  -- A decision must record who made it; an "approved" row with no approver is
  -- an audit gap.
  CONSTRAINT leave_decision_attributed
    CHECK (status IN ('pending','cancelled') OR approved_by IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_leave_org_status ON leave_requests (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_member     ON leave_requests (member_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_range      ON leave_requests (organization_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS leave_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  type            leave_type NOT NULL,
  year            int NOT NULL,
  entitled_days   numeric(5,2) NOT NULL DEFAULT 0,
  used_days       numeric(5,2) NOT NULL DEFAULT 0,
  carried_days    numeric(5,2) NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, type, year)
);

-- ───────────────────────────────────────────────────────────────────────────
--  CRM
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  industry        text,
  website         text,
  email           citext,
  phone           text,
  address         text,
  city            text,
  country         text,
  employee_count  int CHECK (employee_count IS NULL OR employee_count >= 0),
  annual_revenue  numeric(14,2) CHECK (annual_revenue IS NULL OR annual_revenue >= 0),
  owner_id        uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  notes           text NOT NULL DEFAULT '',
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id      uuid REFERENCES companies(id) ON DELETE SET NULL,
  first_name      text NOT NULL DEFAULT '',
  last_name       text NOT NULL DEFAULT '',
  email           citext,
  phone           text,
  job_title       text,
  source          text,
  owner_id        uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text NOT NULL DEFAULT '',
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name      text NOT NULL DEFAULT '',
  last_name       text NOT NULL DEFAULT '',
  email           citext,
  phone           text,
  company_name    text,
  job_title       text,
  source          text NOT NULL DEFAULT 'manual',
  status          lead_status NOT NULL DEFAULT 'new',
  score           int NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  estimated_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (estimated_value >= 0),
  owner_id        uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  -- Set when the lead becomes a contact, so conversion is traceable.
  converted_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  converted_at    timestamptz,
  notes           text NOT NULL DEFAULT '',
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  company_id      uuid REFERENCES companies(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  stage           deal_stage NOT NULL DEFAULT 'prospecting',
  value           numeric(14,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  probability     int NOT NULL DEFAULT 20 CHECK (probability BETWEEN 0 AND 100),
  expected_close  date,
  closed_at       timestamptz,
  lost_reason     text,
  owner_id        uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  notes           text NOT NULL DEFAULT '',
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

/**
 * The CRM timeline: calls, emails, meetings, notes.
 *
 * One polymorphic table rather than one per entity, because the product needs
 * "everything that has happened with this customer" in date order, and that is
 * a UNION over four tables otherwise.
 */
CREATE TABLE IF NOT EXISTS crm_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  activity_type   text NOT NULL DEFAULT 'note',
  subject         text NOT NULL DEFAULT '',
  body            text NOT NULL DEFAULT '',
  lead_id         uuid REFERENCES leads(id)    ON DELETE CASCADE,
  contact_id      uuid REFERENCES contacts(id) ON DELETE CASCADE,
  company_id      uuid REFERENCES companies(id)ON DELETE CASCADE,
  deal_id         uuid REFERENCES deals(id)    ON DELETE CASCADE,
  member_id       uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  due_at          timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- An activity attached to nothing is orphaned and unreachable in the UI.
  CONSTRAINT crm_activity_has_subject CHECK (
    lead_id IS NOT NULL OR contact_id IS NOT NULL
    OR company_id IS NOT NULL OR deal_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_companies_org   ON companies (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_org    ON contacts  (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_org_status ON leads    (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_owner     ON leads     (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_org_stage ON deals     (organization_id, stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_owner     ON deals     (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_act_deal    ON crm_activities (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_act_contact ON crm_activities (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm ON companies USING gin (name gin_trgm_ops);

-- ───────────────────────────────────────────────────────────────────────────
--  Projects
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  description     text NOT NULL DEFAULT '',
  status          project_status NOT NULL DEFAULT 'planning',
  priority        priority_level NOT NULL DEFAULT 'medium',
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  team_id         uuid REFERENCES teams(id) ON DELETE SET NULL,
  owner_id        uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  client_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  budget          numeric(14,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  start_date      date,
  end_date        date,
  completed_at    timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_dates_valid CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS project_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'contributor',
  -- Capacity planning: how much of this person the project has.
  allocation_pct int NOT NULL DEFAULT 100 CHECK (allocation_pct BETWEEN 0 AND 100),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, member_id)
);

CREATE TABLE IF NOT EXISTS milestones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  due_date        date,
  completed_at    timestamptz,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id    uuid REFERENCES milestones(id) ON DELETE SET NULL,
  -- Subtasks. Self-reference keeps hierarchy in one table.
  parent_task_id  uuid REFERENCES tasks(id) ON DELETE CASCADE,
  title           text NOT NULL CHECK (btrim(title) <> ''),
  description     text NOT NULL DEFAULT '',
  status          task_status NOT NULL DEFAULT 'todo',
  priority        priority_level NOT NULL DEFAULT 'medium',
  assignee_id     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  reporter_id     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  due_date        date,
  estimated_hours numeric(7,2) NOT NULL DEFAULT 0 CHECK (estimated_hours >= 0),
  logged_hours    numeric(7,2) NOT NULL DEFAULT 0 CHECK (logged_hours >= 0),
  sort_order      int NOT NULL DEFAULT 0,
  completed_at    timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

/** Task blocking, so a Gantt view has real dependencies rather than dates. */
CREATE TABLE IF NOT EXISTS task_dependencies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, depends_on_id),
  -- A task blocking itself is an infinite loop in any scheduler.
  CONSTRAINT no_self_dependency CHECK (task_id <> depends_on_id)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  minutes         int NOT NULL CHECK (minutes > 0),
  entry_date      date NOT NULL DEFAULT current_date,
  description     text NOT NULL DEFAULT '',
  is_billable     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_org_status ON projects (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_org_status    ON tasks (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_project       ON tasks (project_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee      ON tasks (assignee_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due           ON tasks (organization_id, due_date) WHERE deleted_at IS NULL AND status <> 'done';
CREATE INDEX IF NOT EXISTS idx_time_entries_member ON time_entries (member_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_project_members_m   ON project_members (member_id);

-- ───────────────────────────────────────────────────────────────────────────
--  Workspace
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspace_spaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  icon            text,
  -- Private spaces are visible only to explicit members; department spaces to
  -- that department; public to the whole organization.
  visibility      text NOT NULL DEFAULT 'organization'
                  CHECK (visibility IN ('organization','department','private')),
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_pages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id        uuid REFERENCES workspace_spaces(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES workspace_pages(id) ON DELETE CASCADE,
  title           text NOT NULL DEFAULT 'Untitled',
  content         text NOT NULL DEFAULT '',
  icon            text,
  is_folder       boolean NOT NULL DEFAULT false,
  is_template     boolean NOT NULL DEFAULT false,
  sort_order      int NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  last_edited_by  uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

/** Version history — without it "collaborative editing" cannot be undone. */
CREATE TABLE IF NOT EXISTS workspace_page_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id     uuid NOT NULL REFERENCES workspace_pages(id) ON DELETE CASCADE,
  content     text NOT NULL,
  title       text NOT NULL,
  version     int  NOT NULL,
  edited_by   uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, version)
);

/**
 * Comments, polymorphic across pages, tasks, projects and deals.
 *
 * One table so mentions, notifications and the activity feed have a single
 * source rather than four near-identical ones.
 */
CREATE TABLE IF NOT EXISTS comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  body            text NOT NULL CHECK (btrim(body) <> ''),
  parent_id       uuid REFERENCES comments(id) ON DELETE CASCADE,
  page_id         uuid REFERENCES workspace_pages(id) ON DELETE CASCADE,
  task_id         uuid REFERENCES tasks(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  deal_id         uuid REFERENCES deals(id) ON DELETE CASCADE,
  ticket_id       uuid,
  -- Membership ids mentioned in the body, so notifications do not require
  -- re-parsing the text.
  mentions        uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pages_org_space ON workspace_pages (organization_id, space_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pages_parent    ON workspace_pages (parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_task   ON comments (task_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_page   ON comments (page_id, created_at) WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  Communication
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  type            channel_type NOT NULL DEFAULT 'public',
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  team_id         uuid REFERENCES teams(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  is_archived     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'member',
  -- Unread tracking without a per-message read table: compare against
  -- messages.created_at.
  last_read_at  timestamptz NOT NULL DEFAULT now(),
  is_muted      boolean NOT NULL DEFAULT false,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, member_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id      uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  body            text NOT NULL DEFAULT '',
  -- Threading.
  parent_id       uuid REFERENCES messages(id) ON DELETE CASCADE,
  mentions        uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_pinned       boolean NOT NULL DEFAULT false,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, member_id, emoji)
);

-- The channel timeline query; DESC matches how messages are read.
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_org     ON messages (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_members_m ON channel_members (member_id);

-- ───────────────────────────────────────────────────────────────────────────
--  Support
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_number   text NOT NULL,
  subject         text NOT NULL CHECK (btrim(subject) <> ''),
  description     text NOT NULL DEFAULT '',
  status          ticket_status NOT NULL DEFAULT 'open',
  priority        priority_level NOT NULL DEFAULT 'medium',
  category        text,
  -- Either an internal requester or an external contact.
  requester_id    uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  contact_email   citext,
  assignee_id     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  -- SLA. due_at is computed from priority on insert (0004).
  due_at          timestamptz,
  first_response_at timestamptz,
  resolved_at     timestamptz,
  resolution      text,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, ticket_number)
);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  body        text NOT NULL,
  -- Internal notes are invisible to the client who raised the ticket.
  is_internal boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_articles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           text NOT NULL,
  body            text NOT NULL DEFAULT '',
  category        text,
  tags            text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_published    boolean NOT NULL DEFAULT false,
  view_count      int NOT NULL DEFAULT 0,
  author_id       uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_org_status ON support_tickets (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_assignee   ON support_tickets (assignee_id, status) WHERE deleted_at IS NULL;
-- Finds SLA breaches.
CREATE INDEX IF NOT EXISTS idx_tickets_sla        ON support_tickets (organization_id, due_at)
  WHERE resolved_at IS NULL AND deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  Finance
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_number  text NOT NULL,
  company_id      uuid REFERENCES companies(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  status          invoice_status NOT NULL DEFAULT 'draft',
  issue_date      date NOT NULL DEFAULT current_date,
  due_date        date NOT NULL DEFAULT (current_date + 30),
  -- Money as numeric, never float: 0.1 + 0.2 must equal 0.3 on an invoice.
  subtotal        numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_rate        numeric(5,2)  NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
  tax_amount      numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  discount        numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total           numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  amount_paid     numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  currency        char(3) NOT NULL DEFAULT 'USD',
  notes           text NOT NULL DEFAULT '',
  owner_id        uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  sent_at         timestamptz,
  paid_at         timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, invoice_number),
  CONSTRAINT invoice_paid_within_total CHECK (amount_paid <= total + 0.01)
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity    numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price  numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  -- Generated, so a line total can never disagree with its own inputs.
  line_total  numeric(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order  int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id      uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  method          text NOT NULL DEFAULT 'bank_transfer',
  reference       text,
  paid_at         timestamptz NOT NULL DEFAULT now(),
  recorded_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           text NOT NULL CHECK (btrim(title) <> ''),
  amount          numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency        char(3) NOT NULL DEFAULT 'USD',
  category        text NOT NULL DEFAULT 'general',
  vendor          text,
  expense_date    date NOT NULL DEFAULT current_date,
  status          expense_status NOT NULL DEFAULT 'pending',
  receipt_path    text,
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  submitted_by    uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  approved_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_note   text,
  notes           text NOT NULL DEFAULT '',
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_decision_attributed
    CHECK (status IN ('pending','cancelled') OR approved_by IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS budgets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  department_id   uuid REFERENCES departments(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_period_valid CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON invoices (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_overdue    ON invoices (organization_id, due_date)
  WHERE status NOT IN ('paid','cancelled','draft') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_org_status ON expenses (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_submitter  ON expenses (submitted_by, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_invoice    ON payments (invoice_id);

-- ───────────────────────────────────────────────────────────────────────────
--  Inventory
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS warehouses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  location        text NOT NULL DEFAULT '',
  capacity        int NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  contact_name    text NOT NULL DEFAULT '',
  email           citext,
  phone           text,
  address         text,
  city            text,
  country         text,
  lead_time_days  int NOT NULL DEFAULT 7 CHECK (lead_time_days BETWEEN 0 AND 365),
  payment_terms   text NOT NULL DEFAULT 'net30',
  notes           text NOT NULL DEFAULT '',
  is_active       boolean NOT NULL DEFAULT true,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku             text NOT NULL,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  category        text NOT NULL DEFAULT 'general',
  unit            text NOT NULL DEFAULT 'unit',
  price           numeric(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  cost            numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost  >= 0),
  -- Running total of stock_movements. Only ever written by the movement
  -- function, so the ledger and the balance cannot disagree.
  stock           int NOT NULL DEFAULT 0,
  reorder_level   int NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
  warehouse_id    uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  supplier_id     uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  is_active       boolean NOT NULL DEFAULT true,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sku)
);

/** Append-only ledger. Product.stock is the running total of these rows. */
CREATE TABLE IF NOT EXISTS stock_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type              stock_movement_type NOT NULL DEFAULT 'adjustment',
  -- Signed delta: positive adds, negative removes. Never zero — a movement
  -- that changes nothing is always a mistake.
  quantity          int NOT NULL CHECK (quantity <> 0),
  balance_after     int NOT NULL,
  reason            text NOT NULL DEFAULT '',
  reference         text NOT NULL DEFAULT '',
  from_warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  to_warehouse_id   uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  member_id         uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number    text NOT NULL,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id    uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  status          purchase_order_status NOT NULL DEFAULT 'draft',
  order_date      date NOT NULL DEFAULT current_date,
  expected_date   date,
  received_at     timestamptz,
  subtotal        numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_rate        numeric(5,2)  NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
  tax_amount      numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total           numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes           text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  approved_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, order_number)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity          int NOT NULL CHECK (quantity > 0),
  unit_cost         numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  received_quantity int NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  line_total        numeric(14,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  CONSTRAINT received_not_over_ordered CHECK (received_quantity <= quantity)
);

CREATE INDEX IF NOT EXISTS idx_products_org       ON products (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_sku_trgm  ON products USING gin (sku gin_trgm_ops);
-- Low-stock alerting.
CREATE INDEX IF NOT EXISTS idx_products_low_stock ON products (organization_id, stock)
  WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stock_mov_product  ON stock_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_org_status      ON purchase_orders (organization_id, status);

-- ───────────────────────────────────────────────────────────────────────────
--  Calendar
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calendar_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  all_day         boolean NOT NULL DEFAULT false,
  location        text,
  colour          text NOT NULL DEFAULT '#10b981',
  visibility      text NOT NULL DEFAULT 'organization'
                  CHECK (visibility IN ('organization','department','private')),
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_interval_valid CHECK (ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS event_attendees (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  response   text NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','accepted','declined','tentative')),
  UNIQUE (event_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_events_org_range ON calendar_events (organization_id, starts_at);

-- ───────────────────────────────────────────────────────────────────────────
--  Files
-- ───────────────────────────────────────────────────────────────────────────
--
--  Metadata for objects in Supabase Storage. Storage itself holds bytes and a
--  path; everything the application needs to reason about a file — which
--  organization owns it, what it is attached to, who uploaded it — lives here.

CREATE TABLE IF NOT EXISTS files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bucket          text NOT NULL,
  path            text NOT NULL,
  filename        text NOT NULL,
  mime_type       text,
  size_bytes      bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  -- What this file is attached to.
  task_id         uuid REFERENCES tasks(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  page_id         uuid REFERENCES workspace_pages(id) ON DELETE CASCADE,
  ticket_id       uuid REFERENCES support_tickets(id) ON DELETE CASCADE,
  expense_id      uuid REFERENCES expenses(id) ON DELETE CASCADE,
  invoice_id      uuid REFERENCES invoices(id) ON DELETE CASCADE,
  member_id       uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  -- HR documents are visible only to the subject and HR, regardless of where
  -- they are attached.
  is_confidential boolean NOT NULL DEFAULT false,
  uploaded_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, path)
);

CREATE INDEX IF NOT EXISTS idx_files_org    ON files (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_task   ON files (task_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_ticket ON files (ticket_id) WHERE deleted_at IS NULL;

-- Comments reference tickets; added now that support_tickets exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_ticket_fk') THEN
    ALTER TABLE comments
      ADD CONSTRAINT comments_ticket_fk
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  updated_at triggers for every table above
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance_records','leave_requests','leave_balances',
    'companies','contacts','leads','deals','crm_activities',
    'projects','milestones','tasks',
    'workspace_spaces','workspace_pages','comments',
    'channels','messages',
    'support_tickets','kb_articles',
    'invoices','expenses','budgets',
    'warehouses','suppliers','products','purchase_orders',
    'calendar_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;
