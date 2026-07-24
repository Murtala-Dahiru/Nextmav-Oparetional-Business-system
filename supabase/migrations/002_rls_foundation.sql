-- ═══════════════════════════════════════════════════════════════════════════
--  002 — RLS foundation: tenant resolution without recursion
-- ═══════════════════════════════════════════════════════════════════════════
--
--  WHY THIS EXISTS
--
--  Migration 001 defines the multi-tenant schema, but its policies on
--  `organization_members` resolve tenancy by querying `organization_members`:
--
--      CREATE POLICY "select_own_org" ON organization_members
--        USING (organization_id IN (
--          SELECT organization_id FROM organization_members
--          WHERE user_id = auth.uid() ...));
--
--  Evaluating that policy requires reading the table, which re-triggers the
--  policy. Postgres aborts with:
--
--      ERROR 42P17: infinite recursion detected in policy for relation
--                   "organization_members"
--
--  Because every other table resolves its tenant through that same table, the
--  whole platform fails the moment RLS is on. It was never caught because 001
--  has never been applied to a live database.
--
--  THE FIX
--
--  Resolve tenancy in SECURITY DEFINER functions. They execute as the function
--  owner rather than the caller, so the lookup inside them is not subject to
--  RLS and the cycle is broken. Every policy in this platform must go through
--  these helpers rather than querying membership directly — that is the single
--  rule that keeps RLS both correct and reviewable.
--
--  They are also STABLE, so Postgres evaluates them once per statement instead
--  of once per row. On a 10k-row table that is the difference between one
--  lookup and ten thousand.
--
--  Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. Tenant resolution helpers
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Every organization the current user actively belongs to.
 *
 * Returns an array rather than a set so callers can use `= ANY(...)`, which
 * plans better than `IN (subquery)` inside a policy.
 */
CREATE OR REPLACE FUNCTION public.auth_org_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(om.organization_id), ARRAY[]::uuid[])
  FROM organization_members om
  WHERE om.user_id = auth.uid()
    AND om.is_active = true;
$$;

COMMENT ON FUNCTION public.auth_org_ids() IS
  'Organizations the caller belongs to. SECURITY DEFINER to avoid RLS recursion.';

/** Is the caller an active member of this organization? */
CREATE OR REPLACE FUNCTION public.is_org_member(org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = org
      AND om.is_active = true
  );
$$;

/**
 * The caller's role within an organization, or NULL if not a member.
 *
 * Role lives on the membership row, not on the user: the same person can be an
 * owner of one organization and an employee of another, and a model that
 * cannot express that is not multi-tenant.
 */
CREATE OR REPLACE FUNCTION public.auth_role_in(org uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT om.role::text
  FROM organization_members om
  WHERE om.user_id = auth.uid()
    AND om.organization_id = org
    AND om.is_active = true
  LIMIT 1;
$$;

/** Does the caller hold any of these roles in the organization? */
CREATE OR REPLACE FUNCTION public.has_org_role(org uuid, roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.auth_role_in(org) = ANY(roles);
$$;

/** Administrative control over an organization (settings, members, billing). */
CREATE OR REPLACE FUNCTION public.is_org_admin(org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.auth_role_in(org) = ANY(ARRAY['super_admin','owner','admin']);
$$;

/**
 * The caller's department within an organization.
 *
 * Backs department-scoped policies, which is how a manager sees their team
 * without seeing the whole company.
 */
CREATE OR REPLACE FUNCTION public.auth_department_in(org uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.department
  FROM profiles p
  JOIN organization_members om ON om.user_id = p.id
  WHERE p.id = auth.uid()
    AND om.organization_id = org
    AND om.is_active = true
  LIMIT 1;
$$;

-- Callable by end users; the SECURITY DEFINER body is what does the work.
GRANT EXECUTE ON FUNCTION public.auth_org_ids()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_role_in(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_department_in(uuid)   TO authenticated;

-- Deliberately NOT granted to `anon`. An unauthenticated caller has no
-- membership, and exposing these would let them probe organization ids.

-- ───────────────────────────────────────────────────────────────────────────
--  2. Replace the recursive policies
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "select_own_org" ON organization_members;
DROP POLICY IF EXISTS "insert_own_org" ON organization_members;
DROP POLICY IF EXISTS "update_own_org" ON organization_members;
DROP POLICY IF EXISTS "delete_own_org" ON organization_members;

/**
 * Members see their colleagues.
 *
 * The `user_id = auth.uid()` branch is essential: without it a user whose
 * membership row is the only thing that would let them resolve their own
 * organizations can never read it, and a newly invited member is locked out of
 * the platform they just joined.
 */
CREATE POLICY "members_select" ON organization_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR organization_id = ANY (public.auth_org_ids())
  );

-- Only admins add members. Invitation acceptance runs through a SECURITY
-- DEFINER function (section 4) because the invitee is, by definition, not yet
-- a member and so cannot satisfy this check.
CREATE POLICY "members_insert" ON organization_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "members_update" ON organization_members
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

/**
 * Removing a member is deactivation, not deletion — the audit trail must keep
 * pointing at a real row. The last owner cannot be removed (section 3), or an
 * organization becomes permanently unadministrable.
 */
CREATE POLICY "members_delete" ON organization_members
  FOR DELETE TO authenticated
  USING (
    public.has_org_role(organization_id, ARRAY['super_admin','owner'])
    AND user_id <> auth.uid()
  );

-- ── organizations ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "select_own_org" ON organizations;
DROP POLICY IF EXISTS "insert_own_org" ON organizations;
DROP POLICY IF EXISTS "update_own_org" ON organizations;
DROP POLICY IF EXISTS "delete_own_org" ON organizations;

CREATE POLICY "orgs_select" ON organizations
  FOR SELECT TO authenticated
  USING (id = ANY (public.auth_org_ids()));

/**
 * Anyone signed in may create an organization — that is the signup path, and
 * at that moment the creator has no memberships to check against. The
 * `create_organization` function (section 4) is the supported entry point; it
 * creates the org and the owner membership atomically so an orphan
 * organization with no members can never exist.
 */
CREATE POLICY "orgs_insert" ON organizations
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "orgs_update" ON organizations
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(id))
  WITH CHECK (public.is_org_admin(id));

-- Only an owner may delete, and only via soft delete in practice.
CREATE POLICY "orgs_delete" ON organizations
  FOR DELETE TO authenticated
  USING (public.has_org_role(id, ARRAY['super_admin','owner']));

-- ───────────────────────────────────────────────────────────────────────────
--  3. Integrity guards
-- ───────────────────────────────────────────────────────────────────────────

/**
 * An organization must always retain at least one active owner.
 *
 * Without this, demoting or deactivating the last owner leaves an organization
 * that nobody can administer — recoverable only by direct database access.
 */
CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  remaining int;
BEGIN
  -- Only relevant when an owner is being removed, demoted, or deactivated.
  IF TG_OP = 'UPDATE'
     AND OLD.role::text = 'owner'
     AND NEW.role::text = 'owner'
     AND NEW.is_active = true THEN
    RETURN NEW;
  END IF;

  IF OLD.role::text <> 'owner' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*) INTO remaining
  FROM organization_members
  WHERE organization_id = OLD.organization_id
    AND role::text = 'owner'
    AND is_active = true
    AND user_id <> OLD.user_id;

  IF remaining = 0 THEN
    RAISE EXCEPTION
      'Cannot remove the last owner of this organization. Promote another member to owner first.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_owner_removal ON organization_members;
CREATE TRIGGER trg_prevent_last_owner_removal
  BEFORE UPDATE OR DELETE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_removal();

-- ───────────────────────────────────────────────────────────────────────────
--  4. Onboarding entry points
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Create an organization and make the caller its owner, atomically.
 *
 * Two writes that must not be separable: an organization with no owner is
 * unadministrable, and a membership pointing at no organization is orphaned.
 * Doing this client-side in two round trips guarantees that eventually one of
 * them fails in between.
 */
CREATE OR REPLACE FUNCTION public.create_organization(
  org_name text,
  org_slug text DEFAULT NULL
)
RETURNS organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_org organizations;
  final_slug text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF org_name IS NULL OR btrim(org_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required' USING ERRCODE = 'check_violation';
  END IF;

  -- Derive a URL-safe slug, then de-duplicate with a short suffix.
  final_slug := COALESCE(NULLIF(btrim(org_slug), ''), lower(regexp_replace(org_name, '[^a-zA-Z0-9]+', '-', 'g')));
  final_slug := btrim(both '-' from final_slug);
  IF EXISTS (SELECT 1 FROM organizations WHERE slug = final_slug) THEN
    final_slug := final_slug || '-' || substr(md5(random()::text), 1, 6);
  END IF;

  INSERT INTO organizations (name, slug)
  VALUES (btrim(org_name), final_slug)
  RETURNING * INTO new_org;

  INSERT INTO organization_members (organization_id, user_id, role, is_active, joined_at)
  VALUES (new_org.id, auth.uid(), 'owner', true, now());

  RETURN new_org;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;

/**
 * Accept an invitation.
 *
 * SECURITY DEFINER because the invitee is not yet a member and therefore
 * cannot satisfy the insert policy on `organization_members` — the classic
 * chicken-and-egg of invite-based onboarding. The token is validated here
 * instead: it must exist, be unexpired, unaccepted, and issued to the caller's
 * own email address, so possession of a token alone is not enough to join.
 */
CREATE OR REPLACE FUNCTION public.accept_invitation(invite_token text)
RETURNS organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv        invitations;
  target_org organizations;
  caller_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT email INTO caller_email FROM auth.users WHERE id = auth.uid();

  SELECT * INTO inv FROM invitations WHERE token = invite_token;

  IF inv IS NULL THEN
    RAISE EXCEPTION 'This invitation link is not valid.' USING ERRCODE = 'no_data_found';
  END IF;
  IF inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invitation has already been used.' USING ERRCODE = 'check_violation';
  END IF;
  IF inv.expires_at < now() THEN
    RAISE EXCEPTION 'This invitation has expired. Ask an administrator to send a new one.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Binding the token to the address it was sent to stops a leaked link from
  -- being redeemed by whoever finds it.
  IF lower(inv.email) <> lower(caller_email) THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO organization_members (organization_id, user_id, role, is_active, invited_by, invited_at, joined_at)
  VALUES (inv.organization_id, auth.uid(), inv.role, true, inv.invited_by, inv.created_at, now())
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET is_active = true, joined_at = now();

  UPDATE invitations SET accepted_at = now() WHERE id = inv.id;

  SELECT * INTO target_org FROM organizations WHERE id = inv.organization_id;
  RETURN target_org;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  5. Enable RLS on tenant tables
-- ───────────────────────────────────────────────────────────────────────────
--
--  ENABLE is applied here. FORCE is deliberately NOT — see the warning below.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','organization_members','invitations','profiles',
    'leads','contacts','companies','deals',
    'projects','project_tasks','workspace_pages',
    'channels','channel_members','messages',
    'support_tickets','leave_requests','invoices','expenses',
    'products','warehouses','calendar_events',
    'notifications','activity_log','audit_log','roles','settings'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  ⚠  FORCE ROW LEVEL SECURITY — DO NOT ENABLE YET
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ENABLE does not apply to the table owner, and migrations run as the owner.
--  FORCE closes that gap, and without it RLS is advisory for any connection
--  that authenticates as the owning role. It is the correct end state.
--
--  It cannot be switched on while the application reads through Prisma.
--
--  Prisma connects over DATABASE_URL as the database owner and never sets
--  `request.jwt.claims`. Under FORCE its queries become subject to RLS, so
--  auth.uid() returns NULL, auth_org_ids() returns an empty array, and every
--  policy evaluates false. The result is not an error — it is 54 route files
--  silently returning zero rows, which is far harder to diagnose than a crash.
--
--  Enable this only after data access moves to supabase-js (which carries the
--  user's JWT and satisfies the policies naturally), or after Prisma is
--  switched to a dedicated non-owner role that sets the JWT claims per
--  transaction. Both paths are described in BACKEND_ARCHITECTURE.md.
--
--  When that is done, run:
--
--    DO $force$
--    DECLARE t text;
--    BEGIN
--      FOREACH t IN ARRAY ARRAY[
--        'organizations','organization_members','invitations','profiles',
--        'leads','contacts','companies','deals','projects','project_tasks',
--        'workspace_pages','channels','channel_members','messages',
--        'support_tickets','leave_requests','invoices','expenses','products',
--        'warehouses','calendar_events','notifications','activity_log',
--        'audit_log','roles','settings'
--      ] LOOP
--        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
--          EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
--        END IF;
--      END LOOP;
--    END $force$;
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  6. Indexes for policy evaluation
-- ───────────────────────────────────────────────────────────────────────────
--
--  Every policy calls auth_org_ids(), which filters membership by user. Without
--  this index that lookup is a sequential scan executed on every request.

CREATE INDEX IF NOT EXISTS idx_org_members_user_active
  ON organization_members (user_id, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_org_members_org_user
  ON organization_members (organization_id, user_id);

CREATE INDEX IF NOT EXISTS idx_invitations_token
  ON invitations (token);

CREATE INDEX IF NOT EXISTS idx_invitations_email_pending
  ON invitations (lower(email))
  WHERE accepted_at IS NULL;
