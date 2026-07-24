-- ═══════════════════════════════════════════════════════════════════════════
--  0002 — Tenant resolution helpers
-- ═══════════════════════════════════════════════════════════════════════════
--
--  THE RULE THIS FILE EXISTS TO ENFORCE
--
--  No RLS policy anywhere in this schema may query `organization_members`
--  directly. Every policy resolves tenancy through the functions below.
--
--  Why: a policy on `organization_members` that reads `organization_members`
--  re-enters itself, and Postgres aborts with
--
--      ERROR 42P17: infinite recursion detected in policy for relation
--                   "organization_members"
--
--  Because every table resolves its tenant through that one table, the whole
--  platform fails the moment RLS is switched on. A previous iteration of this
--  schema had exactly that bug in four policies.
--
--  SECURITY DEFINER makes these execute as the function owner, so the lookup
--  inside them is not itself subject to RLS — which breaks the cycle. STABLE
--  lets Postgres evaluate them once per statement instead of once per row; on
--  a 10,000-row table that is one lookup rather than ten thousand.
--
--  `SET search_path` is mandatory on SECURITY DEFINER functions. Without it a
--  caller can prepend a schema they control and have the function execute
--  their own `organization_members`, escalating privilege.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  Identity
-- ───────────────────────────────────────────────────────────────────────────

/** Organizations the caller is an active member of. */
CREATE OR REPLACE FUNCTION public.auth_org_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(om.organization_id), ARRAY[]::uuid[])
  FROM organization_members om
  WHERE om.user_id = auth.uid() AND om.is_active = true;
$$;

/** Is the caller an active member of this organization? */
CREATE OR REPLACE FUNCTION public.is_org_member(org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = auth.uid() AND organization_id = org AND is_active = true
  );
$$;

/** The caller's membership row id within an organization. */
CREATE OR REPLACE FUNCTION public.auth_member_id(org uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM organization_members
  WHERE user_id = auth.uid() AND organization_id = org AND is_active = true
  LIMIT 1;
$$;

/** The caller's role in an organization, NULL if not a member. */
CREATE OR REPLACE FUNCTION public.auth_role_in(org uuid)
RETURNS org_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM organization_members
  WHERE user_id = auth.uid() AND organization_id = org AND is_active = true
  LIMIT 1;
$$;

/** Does the caller hold any of these roles? */
CREATE OR REPLACE FUNCTION public.has_org_role(org uuid, roles org_role[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.auth_role_in(org) = ANY(roles);
$$;

/** Administrative control: settings, members, billing, org-wide configuration. */
CREATE OR REPLACE FUNCTION public.is_org_admin(org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.auth_role_in(org) IN ('owner','administrator');
$$;

/** Owner-only operations: deleting the organization, transferring ownership. */
CREATE OR REPLACE FUNCTION public.is_org_owner(org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.auth_role_in(org) = 'owner';
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  Scope
-- ───────────────────────────────────────────────────────────────────────────

/** The caller's department within an organization. */
CREATE OR REPLACE FUNCTION public.auth_department_id(org uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT department_id FROM organization_members
  WHERE user_id = auth.uid() AND organization_id = org AND is_active = true
  LIMIT 1;
$$;

/**
 * Membership ids the caller may see people-data for.
 *
 * Themselves always; their whole department if they manage people; everyone if
 * they are HR or an administrator. This is the single definition of "whose
 * records may I see", so HR policies cannot drift apart from one another.
 */
CREATE OR REPLACE FUNCTION public.auth_visible_member_ids(org uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.auth_role_in(org) IN ('owner','administrator','hr_staff')
      THEN COALESCE((SELECT array_agg(id) FROM organization_members WHERE organization_id = org), ARRAY[]::uuid[])
    WHEN public.auth_role_in(org) = 'manager'
      THEN COALESCE((
        SELECT array_agg(id) FROM organization_members
        WHERE organization_id = org
          AND (department_id = public.auth_department_id(org)
               OR manager_id = public.auth_member_id(org)
               OR user_id = auth.uid())
      ), ARRAY[]::uuid[])
    ELSE COALESCE((
      SELECT array_agg(id) FROM organization_members
      WHERE organization_id = org AND user_id = auth.uid()
    ), ARRAY[]::uuid[])
  END;
$$;

/**
 * Can the caller approve on behalf of the organization?
 *
 * Approval is deliberately distinct from editing: authorising someone else's
 * leave, expense or purchase order is a different responsibility from
 * changing a record, and most roles have one without the other.
 */
CREATE OR REPLACE FUNCTION public.can_approve(org uuid, domain text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE domain
    WHEN 'hr'      THEN public.auth_role_in(org) IN ('owner','administrator','hr_staff','manager')
    WHEN 'finance' THEN public.auth_role_in(org) IN ('owner','administrator','finance_staff')
    WHEN 'purchase'THEN public.auth_role_in(org) IN ('owner','administrator','finance_staff')
    ELSE public.auth_role_in(org) IN ('owner','administrator')
  END;
$$;

/** Module-level access, mirroring lib/permissions.ts. */
CREATE OR REPLACE FUNCTION public.can_access_module(org uuid, module text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.auth_role_in(org) IS NULL THEN false
    WHEN public.auth_role_in(org) IN ('owner','administrator') THEN true
    WHEN module = 'crm'       THEN public.auth_role_in(org) IN ('manager','sales_staff','finance_staff','support_staff')
    WHEN module = 'finance'   THEN public.auth_role_in(org) IN ('manager','finance_staff')
    WHEN module = 'hr'        THEN true  -- self-service; rows are scoped separately
    WHEN module = 'inventory' THEN public.auth_role_in(org) IN ('manager','finance_staff','sales_staff')
    WHEN module = 'support'   THEN public.auth_role_in(org) IN ('manager','support_staff','client')
    WHEN module = 'projects'  THEN public.auth_role_in(org) <> 'client'
    -- Workspace, communication and calendar are for employees, not externals.
    ELSE public.auth_role_in(org) <> 'client'
  END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  Grants
-- ───────────────────────────────────────────────────────────────────────────
--
--  Deliberately not granted to `anon`. An unauthenticated caller has no
--  membership, and exposing these would let them probe for organization ids.

GRANT EXECUTE ON FUNCTION public.auth_org_ids()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_member_id(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_role_in(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, org_role[])   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_department_id(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_visible_member_ids(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_approve(uuid, text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_module(uuid, text)    TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  Integrity: an organization must always have an owner
-- ───────────────────────────────────────────────────────────────────────────
--
--  Without this, demoting or deactivating the last owner leaves an
--  organization nobody can administer, recoverable only by direct database
--  access.

CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  remaining int;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.role = 'owner' AND NEW.role = 'owner' AND NEW.is_active THEN
    RETURN NEW;
  END IF;

  IF OLD.role <> 'owner' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*) INTO remaining
  FROM organization_members
  WHERE organization_id = OLD.organization_id
    AND role = 'owner' AND is_active = true AND id <> OLD.id;

  IF remaining = 0 THEN
    RAISE EXCEPTION
      'Cannot remove or demote the last owner. Promote another member to owner first.'
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
--  Onboarding entry points
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Create an organization and make the caller its owner, atomically.
 *
 * Two writes that must not be separable: an organization with no owner is
 * unadministrable, and a membership pointing at no organization is orphaned.
 * Done client-side in two round trips, one of them eventually fails in between.
 */
CREATE OR REPLACE FUNCTION public.create_organization(
  org_name text,
  org_slug text DEFAULT NULL
)
RETURNS organizations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_org    organizations;
  final_slug text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF org_name IS NULL OR btrim(org_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required' USING ERRCODE = 'check_violation';
  END IF;

  final_slug := COALESCE(NULLIF(btrim(org_slug), ''),
                         lower(regexp_replace(org_name, '[^a-zA-Z0-9]+', '-', 'g')));
  final_slug := btrim(both '-' from final_slug);
  IF final_slug = '' THEN final_slug := 'org'; END IF;
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

/**
 * Invite someone to an organization.
 *
 * Returns the token so the caller can build the invitation link. Sending the
 * email is the application's job — the database issues the credential.
 */
CREATE OR REPLACE FUNCTION public.invite_to_organization(
  org uuid,
  invite_email text,
  invite_role org_role DEFAULT 'employee',
  invite_department uuid DEFAULT NULL,
  invite_message text DEFAULT NULL
)
RETURNS invitations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv invitations;
BEGIN
  IF NOT public.is_org_admin(org) THEN
    RAISE EXCEPTION 'Only owners and administrators may invite members.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF invite_email IS NULL OR position('@' in invite_email) = 0 THEN
    RAISE EXCEPTION 'A valid email address is required' USING ERRCODE = 'check_violation';
  END IF;

  -- Already a member: inviting again would create a second membership.
  IF EXISTS (
    SELECT 1 FROM organization_members om
    JOIN profiles p ON p.id = om.user_id
    WHERE om.organization_id = org AND p.email = invite_email::citext AND om.is_active
  ) THEN
    RAISE EXCEPTION 'That person is already a member of this organization.'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Re-inviting refreshes the existing pending invitation rather than
  -- accumulating rows, and issues a fresh token so an old link stops working.
  INSERT INTO invitations (organization_id, email, role, department_id, invited_by, message)
  VALUES (org, invite_email::citext, invite_role, invite_department, auth.uid(), invite_message)
  ON CONFLICT (organization_id, email) WHERE status = 'pending'
  DO UPDATE SET
    role          = EXCLUDED.role,
    department_id = EXCLUDED.department_id,
    message       = EXCLUDED.message,
    token         = encode(gen_random_bytes(32), 'hex'),
    expires_at    = now() + interval '7 days',
    invited_by    = auth.uid(),
    updated_at    = now()
  RETURNING * INTO inv;

  RETURN inv;
END;
$$;

/**
 * Accept an invitation.
 *
 * SECURITY DEFINER because the invitee is not yet a member and so cannot
 * satisfy the insert policy on organization_members — the chicken-and-egg at
 * the heart of invite-based onboarding. Validation happens here instead: the
 * token must exist, be pending, unexpired, and issued to the caller's own
 * address, so a leaked link cannot be redeemed by whoever finds it.
 */
CREATE OR REPLACE FUNCTION public.accept_invitation(invite_token text)
RETURNS organizations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv          invitations;
  target_org   organizations;
  caller_email citext;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT email INTO caller_email FROM profiles WHERE id = auth.uid();
  SELECT * INTO inv FROM invitations WHERE token = invite_token;

  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'This invitation link is not valid.' USING ERRCODE = 'no_data_found';
  END IF;
  IF inv.status = 'accepted' THEN
    RAISE EXCEPTION 'This invitation has already been used.' USING ERRCODE = 'check_violation';
  END IF;
  IF inv.status = 'revoked' THEN
    RAISE EXCEPTION 'This invitation was withdrawn.' USING ERRCODE = 'check_violation';
  END IF;
  IF inv.expires_at < now() THEN
    UPDATE invitations SET status = 'expired' WHERE id = inv.id;
    RAISE EXCEPTION 'This invitation has expired. Ask an administrator for a new one.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF inv.email <> caller_email THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO organization_members
    (organization_id, user_id, role, department_id, is_active, invited_by, invited_at, joined_at)
  VALUES
    (inv.organization_id, auth.uid(), inv.role, inv.department_id, true,
     inv.invited_by, inv.created_at, now())
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET is_active = true, role = EXCLUDED.role, joined_at = now();

  UPDATE invitations
  SET status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  WHERE id = inv.id;

  SELECT * INTO target_org FROM organizations WHERE id = inv.organization_id;
  RETURN target_org;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_to_organization(uuid, text, org_role, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;
