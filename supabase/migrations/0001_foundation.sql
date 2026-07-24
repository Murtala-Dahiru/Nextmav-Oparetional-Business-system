-- ═══════════════════════════════════════════════════════════════════════════
--  0001 — Foundation: extensions, enumerated types, tenancy core
-- ═══════════════════════════════════════════════════════════════════════════
--
--  The tenancy model in one paragraph: an `organization` is the tenant
--  boundary. A person is one `profile` (1:1 with auth.users) who may belong to
--  several organizations through `organization_members`. Role and department
--  live on the membership, not on the profile, because the same person can be
--  an owner of one company and an employee of another — a model that puts role
--  on the user cannot express that and will have to be rewritten later.
--
--  Every business table in later migrations carries `organization_id NOT NULL`
--  and is filtered by RLS. One unscoped table is a cross-tenant data leak, and
--  it will not surface in testing against a single organization.
--
--  Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS "citext";      -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- trigram search indexes

-- ───────────────────────────────────────────────────────────────────────────
--  Enumerated types
-- ───────────────────────────────────────────────────────────────────────────
--
--  Enums rather than free text so a typo is a database error instead of a row
--  that silently never matches a filter. Adding a value later is
--  `ALTER TYPE ... ADD VALUE`, which is cheap; removing one is not, so these
--  are deliberately close to the vocabulary the application already uses.

DO $$
BEGIN
  -- Organisation roles. Mirrors RoleId in src/lib/constants.ts; the two must
  -- stay in step or the UI will offer roles the database rejects.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
    CREATE TYPE org_role AS ENUM (
      'owner', 'administrator', 'manager', 'employee',
      'hr_staff', 'finance_staff', 'sales_staff', 'support_staff', 'client'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitation_status') THEN
    CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');
  END IF;

  -- ── HR ──
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
    CREATE TYPE attendance_status AS ENUM (
      'present', 'late', 'early', 'absent', 'on_leave', 'remote', 'holiday', 'half_day'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_type') THEN
    CREATE TYPE leave_type AS ENUM (
      'vacation', 'sick', 'personal', 'maternity', 'paternity', 'bereavement', 'unpaid'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_status') THEN
    CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_type') THEN
    CREATE TYPE employment_type AS ENUM (
      'full_time', 'part_time', 'contract', 'intern', 'temporary'
    );
  END IF;

  -- ── CRM ──
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_status') THEN
    CREATE TYPE lead_status AS ENUM (
      'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deal_stage') THEN
    CREATE TYPE deal_stage AS ENUM (
      'prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'
    );
  END IF;

  -- ── Projects ──
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_status') THEN
    CREATE TYPE project_status AS ENUM (
      'planning', 'active', 'on_hold', 'completed', 'cancelled', 'archived'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'review', 'blocked', 'done');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'priority_level') THEN
    CREATE TYPE priority_level AS ENUM ('low', 'medium', 'high', 'critical');
  END IF;

  -- ── Support ──
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_status') THEN
    CREATE TYPE ticket_status AS ENUM (
      'open', 'in_progress', 'pending', 'resolved', 'closed'
    );
  END IF;

  -- ── Finance ──
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE invoice_status AS ENUM (
      'draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled', 'refunded'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_status') THEN
    CREATE TYPE expense_status AS ENUM ('pending', 'approved', 'rejected', 'reimbursed', 'cancelled');
  END IF;

  -- ── Inventory ──
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_movement_type') THEN
    CREATE TYPE stock_movement_type AS ENUM (
      'receipt', 'issue', 'transfer', 'adjustment', 'return', 'damage'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status') THEN
    CREATE TYPE purchase_order_status AS ENUM (
      'draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled'
    );
  END IF;

  -- ── Cross-cutting ──
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_type') THEN
    CREATE TYPE channel_type AS ENUM ('public', 'private', 'direct', 'announcement');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action') THEN
    CREATE TYPE audit_action AS ENUM (
      'insert', 'update', 'delete', 'login', 'logout', 'export', 'approve', 'reject'
    );
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  organizations — the tenant boundary
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (btrim(name) <> ''),
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  logo_url       text,
  website        text,
  industry       text,
  -- Working-hours policy drives attendance classification. Held per
  -- organization because "late" is a company decision, not a global constant.
  timezone       text NOT NULL DEFAULT 'UTC',
  work_start     time NOT NULL DEFAULT '09:00',
  work_end       time NOT NULL DEFAULT '17:30',
  work_days      int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],  -- 0=Sunday
  grace_minutes  int  NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0),
  break_minutes  int  NOT NULL DEFAULT 30 CHECK (break_minutes >= 0),
  currency       char(3) NOT NULL DEFAULT 'USD',
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Soft delete: an organization's audit trail must outlive the organization.
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE organizations IS 'Tenant boundary. All business data is scoped to exactly one of these.';

-- ───────────────────────────────────────────────────────────────────────────
--  profiles — 1:1 with auth.users
-- ───────────────────────────────────────────────────────────────────────────
--
--  Supabase owns auth.users and it cannot be extended directly. `profiles`
--  holds everything the application knows about a person that is not a
--  credential. Deliberately free of role and organization: those belong to
--  the membership.

CREATE TABLE IF NOT EXISTS profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        citext NOT NULL UNIQUE,
  first_name   text NOT NULL DEFAULT '',
  last_name    text NOT NULL DEFAULT '',
  avatar_url   text,
  phone        text,
  job_title    text,
  bio          text,
  timezone     text,
  locale       text NOT NULL DEFAULT 'en',
  -- Presence. Updated by the realtime layer, used for "who is online".
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE profiles IS 'Person. Role and organization live on organization_members, not here.';

-- Generated full name, so search and display do not each concatenate it.
ALTER TABLE profiles
  DROP COLUMN IF EXISTS full_name;
ALTER TABLE profiles
  ADD COLUMN full_name text
  GENERATED ALWAYS AS (btrim(first_name || ' ' || last_name)) STORED;

CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm
  ON profiles USING gin (full_name gin_trgm_ops);

-- ───────────────────────────────────────────────────────────────────────────
--  departments
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS departments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  description     text NOT NULL DEFAULT '',
  -- Self-reference allows an org chart of arbitrary depth.
  parent_id       uuid REFERENCES departments(id) ON DELETE SET NULL,
  -- The head is a membership, not a bare user: it must be someone in this org.
  head_id         uuid,
  cost_centre     text,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Department names are unique per organization, not globally.
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_departments_org ON departments (organization_id) WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  organization_members — the junction that defines tenancy
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organization_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role            org_role NOT NULL DEFAULT 'employee',
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  -- Reporting line, used by manager-scoped policies and approval routing.
  manager_id      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  employee_number text,
  employment_type employment_type NOT NULL DEFAULT 'full_time',
  hired_on        date,
  is_active       boolean NOT NULL DEFAULT true,
  invited_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  invited_at      timestamptz,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One membership per person per organization.
  UNIQUE (organization_id, user_id),
  UNIQUE (organization_id, employee_number)
);

COMMENT ON TABLE organization_members IS
  'Defines who belongs to which organization and in what role. Every RLS policy resolves through this table via SECURITY DEFINER helpers.';

-- The lookup every single policy performs. Without this index, tenant
-- resolution is a sequential scan on every request.
CREATE INDEX IF NOT EXISTS idx_org_members_user_active
  ON organization_members (user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_org_members_org_role
  ON organization_members (organization_id, role) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_org_members_department
  ON organization_members (department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_members_manager
  ON organization_members (manager_id) WHERE manager_id IS NOT NULL;

-- Department heads must be members of the same organization; added after both
-- tables exist to avoid a circular dependency at creation time.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'departments_head_fk'
  ) THEN
    ALTER TABLE departments
      ADD CONSTRAINT departments_head_fk
      FOREIGN KEY (head_id) REFERENCES organization_members(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  teams — cross-department working groups
-- ───────────────────────────────────────────────────────────────────────────
--
--  Distinct from departments: a department is where you report, a team is what
--  you work on. A person has one department and many teams.

CREATE TABLE IF NOT EXISTS teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  description     text NOT NULL DEFAULT '',
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  lead_id         uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  is_private      boolean NOT NULL DEFAULT false,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS team_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member',
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_teams_org ON teams (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_members_member ON team_members (member_id);

-- ───────────────────────────────────────────────────────────────────────────
--  invitations
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           citext NOT NULL,
  role            org_role NOT NULL DEFAULT 'employee',
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  -- Opaque, unguessable, and unique. Generated server-side; never derived from
  -- the email or the organization, or it would be forgeable.
  token           text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status          invitation_status NOT NULL DEFAULT 'pending',
  invited_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  message         text,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at     timestamptz,
  accepted_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- At most one live invitation per address per organization; re-inviting
-- someone should reuse or replace, not accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_pending_unique
  ON invitations (organization_id, email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_invitations_token  ON invitations (token);
CREATE INDEX IF NOT EXISTS idx_invitations_email  ON invitations (email) WHERE status = 'pending';

-- ───────────────────────────────────────────────────────────────────────────
--  updated_at maintenance
-- ───────────────────────────────────────────────────────────────────────────
--
--  Applied by trigger rather than by the application: an ORM, a SQL editor
--  session and an Edge Function will not all remember to set it, and a stale
--  updated_at silently breaks sync and cache invalidation.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','profiles','departments','organization_members',
    'teams','invitations'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  Provision a profile on signup
-- ───────────────────────────────────────────────────────────────────────────
--
--  auth.users is written by Supabase Auth, which knows nothing about profiles.
--  Without this trigger a user exists but has no profile row, and every join
--  against them returns nothing — an account that appears to sign in
--  successfully and then sees an empty application.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'last_name', ''),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Keep the profile's email in step when it is changed through Supabase Auth.
CREATE OR REPLACE FUNCTION public.handle_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles SET email = NEW.email, updated_at = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_email_change();
