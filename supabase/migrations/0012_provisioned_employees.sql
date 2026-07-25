-- ═══════════════════════════════════════════════════════════════════════════
--  Manual employee provisioning
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Adds what direct provisioning needs and nothing else. Every column here is
--  new and nullable-or-defaulted, so existing rows, policies and queries are
--  unaffected: this migration cannot change the answer to any question the
--  application already asks.
--
--  ── Why is_active is left alone ──────────────────────────────────────────
--
--  Access is decided by `organization_members.is_active`, and a dozen RLS
--  policies and `auth_visible_member_ids()` are written against it. Replacing
--  it with a status enum would mean rewriting all of them, which is a large
--  change to the security boundary in service of a label.
--
--  So `status` is added *beside* it, recording which of the three admin
--  actions produced the current state, while `is_active` stays the one thing
--  that grants or denies access. A trigger keeps the two from drifting, in
--  both directions, because either can be written on its own:
--  `DELETE /api/admin/users/[id]` has always set `is_active` directly and
--  still does.
--
--  Deactivate and suspend are the same state deliberately — both mean "cannot
--  sign in, may come back". Termination is distinct because it is permanent
--  and reporting needs to tell the two apart.

-- ── Password state, on the account rather than the membership ─────────────
--
-- One person can hold memberships in several organizations but has a single
-- password, so this belongs on the profile. A provisioned employee starts with
-- a temporary password and must replace it before the application will do
-- anything for them; `authorize()` refuses every module until it is cleared.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS force_password_change boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

COMMENT ON COLUMN public.profiles.force_password_change IS
  'Set when an administrator issued a temporary password. Cleared only by the '
  'user changing it themselves through /api/auth/change-password.';

COMMENT ON COLUMN public.profiles.password_changed_at IS
  'When the user last set their own password. Null for an account that has '
  'only ever had the one an administrator issued.';

-- ── Membership status ─────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_status') THEN
    CREATE TYPE member_status AS ENUM ('active', 'suspended', 'terminated');
  END IF;
END $$;

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS status member_status NOT NULL DEFAULT 'active';

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS terminated_on date;

-- Existing rows predate the column: anyone already deactivated is suspended,
-- not terminated, because nothing recorded that they had left.
UPDATE public.organization_members
   SET status = 'suspended'
 WHERE is_active = false AND status = 'active';

COMMENT ON COLUMN public.organization_members.status IS
  'Why the membership is in its current state. is_active remains the access '
  'gate; this records whether an inactive member was suspended or terminated.';

/**
 * Keep `status` and `is_active` consistent whichever one was written.
 *
 * Without this they drift immediately: the deactivate endpoint sets only
 * is_active, and the status endpoints set only status, so the directory would
 * show a member as active while every policy denied them — the kind of
 * disagreement that is nearly impossible to diagnose from the outside.
 */
CREATE OR REPLACE FUNCTION public.sync_member_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A row inserted as inactive is suspended unless it said otherwise.
    IF NEW.is_active = false AND NEW.status = 'active' THEN
      NEW.status := 'suspended';
    END IF;
    NEW.is_active := (NEW.status = 'active');
    RETURN NEW;
  END IF;

  -- Status is the more specific statement of intent, so when both changed in
  -- one statement it wins.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.is_active := (NEW.status = 'active');
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF NEW.is_active THEN
      NEW.status := 'active';
    -- Only downgrade to suspended from active: re-deactivating someone who
    -- was terminated must not quietly rewrite that as a suspension.
    ELSIF OLD.status = 'active' THEN
      NEW.status := 'suspended';
    END IF;
  END IF;

  IF NEW.status = 'terminated' AND NEW.terminated_on IS NULL THEN
    NEW.terminated_on := CURRENT_DATE;
  ELSIF NEW.status <> 'terminated' THEN
    NEW.terminated_on := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_member_status ON public.organization_members;
CREATE TRIGGER trg_sync_member_status
  BEFORE INSERT OR UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_member_status();

-- ── Directory view ────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE rather than DROP + CREATE: replacing appends the new
-- columns while leaving the existing ones in place, so nothing that selects
-- from this view — or depends on it — has to be touched. Dropping it would
-- cascade to those dependents.
--
-- Everything above `om.status` is copied verbatim from 0007, including
-- `d.id AS department_id` and `p.id AS user_id`. Those look interchangeable
-- with the `om.*` columns and are not: `d.id` comes through a LEFT JOIN, so a
-- membership pointing at a department row that no longer exists reports NULL
-- rather than a dangling id. Only the four columns at the end are new.

CREATE OR REPLACE VIEW public.v_org_directory
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
  om.manager_id,
  om.status,
  om.terminated_on,
  -- Lets the administration screen show who has not yet replaced the password
  -- they were issued, which is otherwise invisible.
  p.force_password_change,
  p.password_changed_at
FROM organization_members om
JOIN profiles p              ON p.id = om.user_id
LEFT JOIN departments d      ON d.id = om.department_id
LEFT JOIN organization_members mgr ON mgr.id = om.manager_id
LEFT JOIN profiles mgr_p     ON mgr_p.id = mgr.user_id;

COMMENT ON VIEW public.v_org_directory IS
  'Employee directory. Respects RLS via security_invoker.';
