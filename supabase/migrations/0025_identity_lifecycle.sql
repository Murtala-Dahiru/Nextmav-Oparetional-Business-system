-- ═══════════════════════════════════════════════════════════════════════════
--  0025 — The identity lifecycle, end to end
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Everything before this migration could describe an account's state. Nothing
--  could end one. The three defects that follow from that are all the same
--  defect seen from different angles.
--
--  ── 1. Deactivation was a filter, not a revocation ────────────────────────
--
--  `getContext()` reads memberships `WHERE is_active = true`. Deactivate the
--  only membership and it resolves nothing — which the session endpoint
--  reports, quite reasonably, as "authenticated but belongs to no
--  organization". That is the same state a brand-new signup is in, so the
--  dashboard sends them to /onboarding, and `create_organization()` asks only
--  whether `auth.uid()` is null.
--
--  A terminated employee therefore signs in with credentials that still work,
--  is offered the new-workspace wizard, and comes out the other side owning a
--  tenant. Nothing in the platform was broken; the states "has no organization
--  yet" and "had one taken away" were simply never distinguished.
--
--  Fixed by making the distinction real: `account_access_state()` names the
--  state, and `create_organization()` refuses the ones that must not lead
--  anywhere.
--
--  ── 2. Permanent deletion could not be built on DELETE ────────────────────
--
--  Seventeen columns reference `organization_members` with ON DELETE CASCADE,
--  sixteen of them NOT NULL: messages.sender_id, comments.author_id,
--  meetings.host_id, time_entries, attendance, leave, todos. Deleting one
--  membership row erases that person's entire trace from the organization,
--  including the half of every conversation they were part of.
--
--  So permanent deletion here removes the *identity*, not the *record*. The
--  membership row survives as a tombstone — every foreign key still resolves,
--  no history is rewritten — while the auth user is deleted, access ends, and
--  the email address is freed for reuse. That required breaking one link:
--  `profiles.id` used to cascade from auth.users, which would have pulled the
--  whole graph down with the login. It no longer does, and a trigger on
--  auth.users tombstones instead, so deleting someone from the Supabase
--  dashboard now does the safe thing rather than the catastrophic one.
--
--  ── 3. The invitee had to become an owner first ───────────────────────────
--
--  An invited person with no account was sent to /signup, which requires an
--  organization name and creates one. They owned a workspace nobody asked for
--  before they could join the one that invited them. `pending_invitation_for()`
--  lets signup recognise them and skip that.
--
--  Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. Account provenance
-- ───────────────────────────────────────────────────────────────────────────
--
--  Why an account exists decides what it may do once it belongs nowhere.
--
--  Someone who signed up for the platform themselves and has since left every
--  organization is a customer between workspaces — they may create another.
--  Someone an employer provisioned or invited has no independent relationship
--  with the platform at all; when their employer ends it, it is over. Without
--  this column the two are indistinguishable, and the safe answer for one is
--  the wrong answer for the other.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_origin') THEN
    CREATE TYPE account_origin AS ENUM ('self_signup', 'invited', 'provisioned');
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_origin account_origin NOT NULL DEFAULT 'self_signup';

-- Set when the auth identity is removed. The profile stays so that history
-- keeps resolving; this is what marks it as no longer a person who can sign in.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auth_deleted_at timestamptz;

-- The address the account had before deletion freed it. Kept for the audit
-- trail: "who was member 4f2c…" must remain answerable, and the tombstone's
-- live email column has been rewritten to a sentinel so the real one can be
-- registered again.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_email citext;

COMMENT ON COLUMN public.profiles.account_origin IS
  'How this account came to exist. Decides whether it may create an '
  'organization once it belongs to none.';
COMMENT ON COLUMN public.profiles.auth_deleted_at IS
  'The auth identity has been permanently removed. The profile row remains so '
  'that historical foreign keys still resolve.';
COMMENT ON COLUMN public.profiles.is_active IS
  'Platform-level gate. False means this person cannot use the platform at all, '
  'regardless of any membership. organization_members.is_active is the '
  'per-organization gate.';

-- ───────────────────────────────────────────────────────────────────────────
--  2. Unhook the profile from the auth cascade
-- ───────────────────────────────────────────────────────────────────────────
--
--  `profiles.id REFERENCES auth.users(id) ON DELETE CASCADE` reads as tidy
--  housekeeping and is in fact the reason permanent deletion could not be
--  implemented. Deleting the auth user removed the profile, which removed every
--  membership, which cascaded into sixteen NOT NULL columns across messages,
--  comments, meetings, attendance, leave, time entries and todos.
--
--  Dropping it does not orphan anything: `profiles.id` is still the auth user's
--  id, and the trigger below keeps the two in step when a deletion happens
--  outside this application — a `DELETE FROM auth.users` in the Supabase
--  dashboard now tombstones rather than detonates.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

/**
 * Turn a profile into a tombstone.
 *
 * Shared by the deletion RPC and by the auth.users trigger, so both routes to
 * the same outcome produce the same row. Idempotent — running it on an already
 * tombstoned profile changes nothing, which matters because the RPC tombstones
 * first and the trigger fires afterwards.
 *
 * Freeing the email is the whole point of rewriting it. `profiles.email` is
 * UNIQUE, so leaving the original in place would make the address permanently
 * unregisterable even though the auth user holding it is gone — deletion that
 * silently burns an address is not deletion, it is a different bug.
 */
CREATE OR REPLACE FUNCTION public.tombstone_profile(target_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.profiles
     SET deleted_email          = COALESCE(deleted_email, email),
         email                  = ('deleted+' || id::text || '@account.invalid')::citext,
         is_active              = false,
         auth_deleted_at        = COALESCE(auth_deleted_at, now()),
         -- Meaningless once there is no password to change, and leaving it set
         -- would make a tombstone look like an account mid-onboarding.
         force_password_change  = false,
         updated_at             = now()
   WHERE id = target_user
     AND auth_deleted_at IS NULL;

  -- Access ends everywhere at once. A tombstone that still held an active
  -- membership somewhere would be a member nobody can sign in as and every
  -- directory would still list.
  UPDATE public.organization_members
     SET is_active  = false,
         status     = 'terminated',
         deleted_at = COALESCE(deleted_at, now())
   WHERE user_id = target_user
     AND deleted_at IS NULL;
END;
$$;

/**
 * Deleting an auth user tombstones rather than cascades.
 *
 * The FK that used to do this is gone (see above), and its absence is only
 * safe because of this. Deleting a user from the Supabase dashboard is a
 * completely ordinary operator action, and before this it was the single most
 * destructive thing anyone could do to this database.
 */
CREATE OR REPLACE FUNCTION public.handle_auth_user_deleted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.tombstone_profile(OLD.id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_deleted();

-- ───────────────────────────────────────────────────────────────────────────
--  3. Provenance is recorded at creation
-- ───────────────────────────────────────────────────────────────────────────
--
--  Read from the same `raw_user_meta_data` the first and last name already
--  come through, so provisioning and invited signup can both state it without
--  a second write that might not happen.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  origin account_origin;
BEGIN
  BEGIN
    origin := COALESCE(NEW.raw_user_meta_data ->> 'account_origin', 'self_signup')::account_origin;
  EXCEPTION WHEN OTHERS THEN
    -- An unrecognised value must not stop an account being created, and the
    -- least-privileged reading of an unknown origin is the most restrictive
    -- one: treat them as provisioned, which cannot create an organization.
    origin := 'provisioned';
  END;

  INSERT INTO public.profiles (id, email, first_name, last_name, avatar_url, account_origin)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'last_name', ''),
    NEW.raw_user_meta_data ->> 'avatar_url',
    origin
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  4. A membership that has been deleted, as distinct from ended
-- ───────────────────────────────────────────────────────────────────────────
--
--  `status` already told suspension and termination apart. Deletion needs a
--  third mark and cannot be another enum value: `ALTER TYPE … ADD VALUE`
--  cannot be used in the transaction that adds it, and every migration here
--  runs in one transaction. A timestamp is better anyway — it records when.

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.organization_members.deleted_at IS
  'The account was permanently deleted. The row is retained as a tombstone so '
  'that messages, comments, approvals and audit entries still resolve to a real '
  'member; it is excluded from every directory and can never be reactivated.';

CREATE INDEX IF NOT EXISTS idx_org_members_live
  ON organization_members (organization_id, user_id) WHERE deleted_at IS NULL;

/**
 * Keep status, is_active and deleted_at from contradicting each other.
 *
 * Extends 0012's trigger rather than replacing its reasoning: status is still
 * the more specific statement of intent and still wins over is_active. Two
 * rules are new.
 *
 * A tombstone is terminal. Every path that could reactivate one — the invite
 * flow's ON CONFLICT, an administrator toggling is_active, a status change from
 * the directory screen — is refused here rather than in each of them, because a
 * resurrected tombstone is an account whose auth identity no longer exists and
 * which therefore appears in the directory as a member who can never sign in.
 *
 * And `terminated_on` is no longer cleared when a deleted membership is
 * touched: 0012 nulls it for any status other than 'terminated', which was
 * right when those were the only two states.
 */
CREATE OR REPLACE FUNCTION public.sync_member_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_active = false AND NEW.status = 'active' THEN
      NEW.status := 'suspended';
    END IF;
    NEW.is_active := (NEW.status = 'active');
    IF NEW.deleted_at IS NOT NULL THEN
      NEW.is_active := false;
      NEW.status    := 'terminated';
    END IF;
    RETURN NEW;
  END IF;

  -- A tombstone accepts no further lifecycle changes. Reassignment of records
  -- away from it is a different kind of write and is not blocked.
  IF OLD.deleted_at IS NOT NULL THEN
    NEW.deleted_at := OLD.deleted_at;
    NEW.is_active  := false;
    NEW.status     := 'terminated';
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.is_active := (NEW.status = 'active');
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF NEW.is_active THEN
      NEW.status := 'active';
    ELSIF OLD.status = 'active' THEN
      NEW.status := 'suspended';
    END IF;
  END IF;

  -- Becoming a tombstone in this same statement, which is what
  -- delete_member_account() does.
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.is_active := false;
    NEW.status    := 'terminated';
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

-- ───────────────────────────────────────────────────────────────────────────
--  5. Hard DELETE on a membership is withdrawn
-- ───────────────────────────────────────────────────────────────────────────
--
--  `members_delete` let an owner remove a membership row outright. The cascade
--  behind that column takes the person's messages, comments, meetings, time
--  entries, attendance, leave, todos and project memberships with it — from a
--  screen whose button says "remove from organization".
--
--  There is no legitimate caller. Permanent removal now goes through
--  `delete_member_account()`, which reviews the impact first and leaves the row
--  in place. Dropping the policy makes the destructive path unreachable rather
--  than merely unused.

DROP POLICY IF EXISTS members_delete ON public.organization_members;

COMMENT ON TABLE public.organization_members IS
  'Defines who belongs to which organization and in what role. Every RLS policy '
  'resolves through this table via SECURITY DEFINER helpers. Rows are never '
  'deleted — sixteen NOT NULL columns cascade from this one. Use '
  'delete_member_account().';

-- ───────────────────────────────────────────────────────────────────────────
--  6. What state is this account in?
-- ───────────────────────────────────────────────────────────────────────────
--
--  One answer, resolved in the database, so the login endpoint, the session
--  endpoint, the request guards and the onboarding gate cannot disagree about
--  whether someone is between workspaces or has been shown the door.

/** Is there a live invitation waiting for this address? */
CREATE OR REPLACE FUNCTION public.pending_invitation_for(addr citext)
RETURNS TABLE (organization_id uuid, organization_name text, role org_role, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.organization_id, o.name, i.role, i.expires_at
  FROM invitations i
  JOIN organizations o ON o.id = i.organization_id
  WHERE i.email = addr
    AND i.status = 'pending'
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
  LIMIT 1;
$$;

/**
 * The caller's platform-level standing.
 *
 *   active           at least one live membership
 *   suspended        no live membership; at least one suspended
 *   terminated       no live membership; employment ended
 *   removed          every membership is a tombstone
 *   disabled         the profile itself is switched off
 *   invited          no membership, but an invitation is waiting
 *   no_organization  a fresh account that has not joined anywhere
 *
 *  `mayCreateOrganization` is the rule that closes the hole this migration
 *  exists for, and it is computed here rather than in the application so that
 *  `create_organization()` and the screens that offer it cannot drift apart.
 */
CREATE OR REPLACE FUNCTION public.account_access_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid          uuid := auth.uid();
  prof         public.profiles;
  n_active     int := 0;
  n_suspended  int := 0;
  n_terminated int := 0;
  n_deleted    int := 0;
  n_invites    int := 0;
  resolved     text;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('state', 'anonymous', 'mayCreateOrganization', false);
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = uid;
  IF prof.id IS NULL THEN
    -- Authenticated with no profile row. Provisioning failed rather than the
    -- account being in any lifecycle state, and it must not be read as one.
    RETURN jsonb_build_object('state', 'no_profile', 'mayCreateOrganization', false);
  END IF;

  SELECT
    count(*) FILTER (WHERE deleted_at IS NULL AND is_active),
    count(*) FILTER (WHERE deleted_at IS NULL AND NOT is_active AND status = 'suspended'),
    count(*) FILTER (WHERE deleted_at IS NULL AND NOT is_active AND status = 'terminated'),
    count(*) FILTER (WHERE deleted_at IS NOT NULL)
  INTO n_active, n_suspended, n_terminated, n_deleted
  FROM public.organization_members
  WHERE user_id = uid;

  SELECT count(*) INTO n_invites
  FROM public.invitations
  WHERE email = prof.email AND status = 'pending' AND expires_at > now();

  resolved := CASE
    WHEN prof.auth_deleted_at IS NOT NULL THEN 'removed'
    WHEN prof.is_active = false            THEN 'disabled'
    WHEN n_active     > 0                  THEN 'active'
    WHEN n_suspended  > 0                  THEN 'suspended'
    WHEN n_terminated > 0                  THEN 'terminated'
    WHEN n_deleted    > 0                  THEN 'removed'
    WHEN n_invites    > 0                  THEN 'invited'
    ELSE 'no_organization'
  END;

  RETURN jsonb_build_object(
    'state',               resolved,
    'accountOrigin',       prof.account_origin,
    'activeMemberships',   n_active,
    'endedMemberships',    n_suspended + n_terminated + n_deleted,
    'pendingInvitations',  n_invites,
    /**
     * An active member may found another workspace — a consultancy or a group
     * genuinely runs several, and that has always been allowed.
     *
     * Someone who belongs nowhere may only do so if they came to the platform
     * on their own account and have never had access ended. That is the clause
     * a suspended or terminated employee used to walk straight through.
     */
    'mayCreateOrganization',
      n_active > 0
      OR (prof.is_active
          AND prof.auth_deleted_at IS NULL
          AND prof.account_origin = 'self_signup'
          AND n_suspended = 0 AND n_terminated = 0 AND n_deleted = 0)
  );
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  7. The onboarding entry points, holding the line
-- ───────────────────────────────────────────────────────────────────────────

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
  access     jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  /**
   * The gate this function never had.
   *
   * Refused here rather than in the route because the route is not the only
   * caller: the RPC is granted to `authenticated`, so anyone with a session and
   * a REST client could reach it directly. A check in the application would
   * have read as a fix and stopped nothing.
   */
  access := public.account_access_state();
  IF NOT (access ->> 'mayCreateOrganization')::boolean THEN
    RAISE EXCEPTION '%', CASE access ->> 'state'
      WHEN 'suspended'  THEN 'Your access has been suspended. Contact your organization''s administrator.'
      WHEN 'terminated' THEN 'Your access to this platform has ended. Contact your organization''s administrator.'
      WHEN 'removed'    THEN 'This account has been removed.'
      WHEN 'disabled'   THEN 'This account has been disabled.'
      ELSE 'This account is not permitted to create an organization.'
    END USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF org_name IS NULL OR btrim(org_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required' USING ERRCODE = 'check_violation';
  END IF;

  final_slug := COALESCE(NULLIF(btrim(org_slug), ''),
                         lower(regexp_replace(org_name, '[^a-zA-Z0-9]+', '-', 'g')));
  final_slug := btrim(final_slug, '-');
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
 * Unchanged except for the two states that did not exist when it was written:
 * a tombstoned membership cannot be re-invited (there is no identity left to
 * invite — issue a fresh invitation to the address instead, which now works
 * because deletion freed it), and a platform-disabled account cannot be pulled
 * back in through an invitation.
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

  IF EXISTS (
    SELECT 1 FROM organization_members om
    JOIN profiles p ON p.id = om.user_id
    WHERE om.organization_id = org
      AND p.email = invite_email::citext
      AND om.is_active
      AND om.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'That person is already a member of this organization.'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO invitations (organization_id, email, role, department_id, invited_by, message)
  VALUES (org, invite_email::citext, invite_role, invite_department, auth.uid(), invite_message)
  ON CONFLICT (organization_id, email) WHERE status = 'pending'
  DO UPDATE SET
    role          = EXCLUDED.role,
    department_id = EXCLUDED.department_id,
    message       = EXCLUDED.message,
    token         = encode(extensions.gen_random_bytes(32), 'hex'),
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
 * Two lifecycle rules are new. A platform-disabled or removed account cannot
 * redeem anything — otherwise an invitation is a way back in for an identity
 * the platform has finished with. And rehiring is stated rather than implied:
 * the ON CONFLICT branch now resets status and clears `terminated_on`, because
 * a returning employee whose row still says 'terminated' is a member every
 * report counts as having left.
 *
 * A tombstoned membership is refused outright. Its auth identity is gone, so
 * "the same person" returning is a genuinely new account, and reviving the row
 * would produce a member nobody can sign in as.
 */
CREATE OR REPLACE FUNCTION public.accept_invitation(invite_token text)
RETURNS organizations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv          invitations;
  target_org   organizations;
  caller       profiles;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO caller FROM profiles WHERE id = auth.uid();
  IF caller.id IS NULL THEN
    RAISE EXCEPTION 'This account is not fully set up. Sign out and in again.'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF caller.auth_deleted_at IS NOT NULL OR caller.is_active = false THEN
    RAISE EXCEPTION 'This account has been disabled and cannot join an organization.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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
  IF inv.email <> caller.email THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = inv.organization_id
      AND user_id = auth.uid()
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This account was permanently removed from that organization and cannot rejoin it.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO organization_members
    (organization_id, user_id, role, department_id, is_active, invited_by, invited_at, joined_at)
  VALUES
    (inv.organization_id, auth.uid(), inv.role, inv.department_id, true,
     inv.invited_by, inv.created_at, now())
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET
    is_active     = true,
    status        = 'active',
    terminated_on = NULL,
    role          = EXCLUDED.role,
    department_id = COALESCE(EXCLUDED.department_id, organization_members.department_id),
    joined_at     = now();

  UPDATE invitations
  SET status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  WHERE id = inv.id;

  SELECT * INTO target_org FROM organizations WHERE id = inv.organization_id;
  RETURN target_org;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  8. Permanent deletion: review, then remove
-- ───────────────────────────────────────────────────────────────────────────
--
--  The two halves are deliberately separate calls. An administrator must be
--  able to see what a deletion would touch *before* committing to it, and a
--  single endpoint that both reports and destroys cannot offer that.

/**
 * Everything in this organization that points at a member, split by what
 * should happen to it.
 *
 *   reassign  — a live responsibility. Somebody has to own it tomorrow, and if
 *               nobody does the record silently stops appearing in the filters
 *               people work from.
 *   retain    — a fact about the past. Reassigning it would be falsification:
 *               the expense really was approved by this person, the message
 *               really was sent by them. These keep pointing at the tombstone.
 *   personal  — theirs alone. Attendance, leave, private to-dos. Retained
 *               because HR and payroll records outlive employment, and because
 *               deleting them is what the CASCADE already does badly.
 */
CREATE OR REPLACE FUNCTION public.member_deletion_impact(target_member uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target     organization_members;
  prof       profiles;
  org        uuid;
  rec        record;
  n          bigint;
  items      jsonb := '[]'::jsonb;
  blockers   jsonb := '[]'::jsonb;
  needs      boolean := false;
  owners_left int;
BEGIN
  SELECT * INTO target FROM organization_members WHERE id = target_member;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'That member does not exist.' USING ERRCODE = 'no_data_found';
  END IF;
  org := target.organization_id;

  IF NOT public.is_org_admin(org) THEN
    RAISE EXCEPTION 'Only owners and administrators may review an account for deletion.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO prof FROM profiles WHERE id = target.user_id;

  -- ── Blockers ────────────────────────────────────────────────────────────
  IF target.user_id = auth.uid() THEN
    blockers := blockers || to_jsonb('You cannot delete your own account. Ask another administrator.'::text);
  END IF;
  IF target.deleted_at IS NOT NULL THEN
    blockers := blockers || to_jsonb('This account has already been deleted.'::text);
  END IF;
  IF target.role = 'owner' THEN
    SELECT count(*) INTO owners_left FROM organization_members
     WHERE organization_id = org AND role = 'owner' AND is_active
       AND deleted_at IS NULL AND id <> target_member;
    IF owners_left = 0 THEN
      blockers := blockers ||
        to_jsonb('This is the only owner. Promote another member to owner first.'::text);
    END IF;
  END IF;

  -- ── What points at them ─────────────────────────────────────────────────
  --
  -- Driven from a table rather than written out, and every entry is checked
  -- against the catalogue first, so a column renamed in a later migration
  -- makes this report one line shorter instead of raising 42703 in the middle
  -- of a deletion review.
  FOR rec IN
    SELECT * FROM (VALUES
      -- Live responsibility. Reassigned on deletion.
      ('departments',           'head_id',     'Departments they head',        'reassign'),
      ('teams',                 'lead_id',     'Teams they lead',              'reassign'),
      ('organization_members',  'manager_id',  'People reporting to them',     'reassign'),
      ('projects',              'owner_id',    'Projects they own',            'reassign'),
      ('milestones',            'owner_id',    'Milestones they own',          'reassign'),
      ('tasks',                 'assignee_id', 'Tasks assigned to them',       'reassign'),
      ('leads',                 'owner_id',    'Leads they own',               'reassign'),
      ('deals',                 'owner_id',    'Deals they own',               'reassign'),
      ('companies',             'owner_id',    'Customers they own',           'reassign'),
      ('contacts',              'owner_id',    'Contacts they own',            'reassign'),
      ('invoices',              'owner_id',    'Invoices they own',            'reassign'),
      ('support_tickets',       'assignee_id', 'Tickets assigned to them',     'reassign'),
      -- The past. Left pointing at the tombstone.
      ('messages',              'sender_id',   'Messages they sent',           'retain'),
      ('comments',              'author_id',   'Comments they wrote',          'retain'),
      ('ticket_comments',       'author_id',   'Ticket replies they wrote',    'retain'),
      ('announcements',         'author_id',   'Announcements they published', 'retain'),
      ('kb_articles',           'author_id',   'Knowledge articles they wrote','retain'),
      ('meetings',              'host_id',     'Meetings they hosted',         'retain'),
      ('expenses',              'approved_by', 'Expenses they approved',       'retain'),
      ('leave_requests',        'approved_by', 'Leave they approved',          'retain'),
      ('purchase_orders',       'approved_by', 'Purchase orders they approved','retain'),
      ('payments',              'recorded_by', 'Payments they recorded',       'retain'),
      ('stock_movements',       'member_id',   'Stock movements they made',    'retain'),
      ('workspace_pages',       'created_by',  'Workspace pages they created', 'retain'),
      ('files',                 'uploaded_by', 'Files they uploaded',          'retain'),
      ('activity_log',          'member_id',   'Activity log entries',         'retain'),
      -- Theirs. Retained; employment records outlive employment.
      ('attendance_records',    'member_id',   'Attendance records',           'personal'),
      ('leave_requests',        'member_id',   'Leave requests',               'personal'),
      ('leave_balances',        'member_id',   'Leave balances',               'personal'),
      ('time_entries',          'member_id',   'Time entries',                 'personal'),
      ('todos',                 'member_id',   'Private to-dos',               'personal'),
      -- Rosters and access. Removed on deletion.
      ('project_members',       'member_id',   'Project memberships',          'revoke'),
      ('team_members',          'member_id',   'Team memberships',             'revoke'),
      ('channel_members',       'member_id',   'Channel memberships',          'revoke'),
      ('event_attendees',       'member_id',   'Calendar invitations',         'revoke'),
      ('meeting_participants',  'member_id',   'Meeting invitations',          'revoke'),
      ('workspace_page_shares', 'member_id',   'Page shares',                  'revoke'),
      ('notifications',         'recipient_id','Undelivered notifications',    'revoke')
    ) AS t(tbl, col, label, kind)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = rec.tbl AND column_name = rec.col
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', rec.tbl, rec.col)
      INTO n USING target_member;

    IF n > 0 THEN
      items := items || jsonb_build_object(
        'table', rec.tbl, 'column', rec.col,
        'label', rec.label, 'kind', rec.kind, 'count', n
      );
      IF rec.kind = 'reassign' THEN needs := true; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'memberId',            target_member,
    'userId',              target.user_id,
    'email',               prof.email,
    'fullName',            prof.full_name,
    'role',                target.role,
    'status',              target.status,
    'alreadyDeleted',      target.deleted_at IS NOT NULL,
    'blockers',            blockers,
    'canDelete',           jsonb_array_length(blockers) = 0,
    'requiresReassignment', needs,
    'items',               items,
    /**
     * Whether the auth identity itself goes.
     *
     * Only when this is their last live membership. Someone who also works for
     * another tenant on this platform loses access *here* and keeps their
     * account — deleting the login because one of their employers ended the
     * relationship would be a cross-tenant action, which is exactly the class
     * of mistake tenancy exists to prevent.
     */
    'removesPlatformIdentity', (
      SELECT count(*) = 1 FROM organization_members
      WHERE user_id = target.user_id AND deleted_at IS NULL
    ),
    'otherOrganizations', (
      SELECT count(*) FROM organization_members
      WHERE user_id = target.user_id AND deleted_at IS NULL AND id <> target_member
    )
  );
END;
$$;

/**
 * Delete an account, permanently.
 *
 * Returns `authUserToDelete` when the caller must finish the job by removing
 * the auth user — which only the service role can do, so it cannot happen in
 * here. The profile is tombstoned *first*, which frees the email address, so a
 * failure at that last step leaves an account that can still authenticate but
 * can do nothing at all rather than one that has quietly kept its access.
 */
CREATE OR REPLACE FUNCTION public.delete_member_account(
  target_member uuid,
  reassign_to   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target       organization_members;
  prof         profiles;
  org          uuid;
  impact       jsonb;
  rec          record;
  moved        bigint;
  reassigned   jsonb := '{}'::jsonb;
  removes_auth boolean;
  live_email   citext;
BEGIN
  SELECT * INTO target FROM organization_members WHERE id = target_member;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'That member does not exist.' USING ERRCODE = 'no_data_found';
  END IF;
  org := target.organization_id;

  IF NOT public.is_org_admin(org) THEN
    RAISE EXCEPTION 'Only owners and administrators may delete an account.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  impact := public.member_deletion_impact(target_member);

  IF NOT (impact ->> 'canDelete')::boolean THEN
    RAISE EXCEPTION '%', (impact -> 'blockers' ->> 0) USING ERRCODE = 'check_violation';
  END IF;

  -- ── The reassignment target ─────────────────────────────────────────────
  IF reassign_to IS NOT NULL THEN
    IF reassign_to = target_member THEN
      RAISE EXCEPTION 'Records cannot be reassigned to the account being deleted.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM organization_members
      WHERE id = reassign_to AND organization_id = org AND is_active AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Records can only be reassigned to an active member of this organization.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (impact ->> 'requiresReassignment')::boolean THEN
    RAISE EXCEPTION
      'This account still owns live records. Choose someone to take them over before deleting it.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO prof FROM profiles WHERE id = target.user_id;
  live_email := COALESCE(prof.deleted_email, prof.email);

  -- ── Hand the live work over ─────────────────────────────────────────────
  IF reassign_to IS NOT NULL THEN
    FOR rec IN
      SELECT * FROM jsonb_array_elements(impact -> 'items') AS e(item)
      WHERE e.item ->> 'kind' = 'reassign'
    LOOP
      /**
       * `AND id <> $1` matters for exactly one row in the whole list.
       *
       * When the reassignment target is one of the people who reported to the
       * account being deleted, handing them the reporting line makes them their
       * own manager — a loop that approval routing follows until it gives up.
       * The clause is harmless everywhere else: no other table in the list has
       * an `id` that could equal a membership id.
       */
      EXECUTE format(
        'UPDATE public.%I SET %I = $1 WHERE %I = $2%s',
        rec.item ->> 'table', rec.item ->> 'column', rec.item ->> 'column',
        CASE WHEN rec.item ->> 'table' = 'organization_members' THEN ' AND id <> $1' ELSE '' END
      ) USING reassign_to, target_member;
      GET DIAGNOSTICS moved = ROW_COUNT;
      reassigned := reassigned || jsonb_build_object(
        (rec.item ->> 'table') || '.' || (rec.item ->> 'column'), moved
      );
    END LOOP;
  END IF;

  -- ── Take away everything forward-looking ────────────────────────────────
  --
  -- Rosters and pending invitations, not history. Leaving a deleted account on
  -- a project team or in a private channel is an access-control statement that
  -- outlived the access, and every "who is in this channel" count would be
  -- wrong for ever.
  FOR rec IN
    SELECT * FROM (VALUES
      ('project_members',       'member_id'),
      ('team_members',          'member_id'),
      ('channel_members',       'member_id'),
      ('event_attendees',       'member_id'),
      ('meeting_participants',  'member_id'),
      ('workspace_page_shares', 'member_id'),
      ('notifications',         'recipient_id')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = rec.tbl AND column_name = rec.col
    ) THEN
      EXECUTE format('DELETE FROM public.%I WHERE %I = $1', rec.tbl, rec.col)
        USING target_member;
    END IF;
  END LOOP;

  -- Any invitation still outstanding for this address in this organization is
  -- withdrawn; redeeming it afterwards would resurrect the membership.
  UPDATE invitations
     SET status = 'revoked', revoked_at = now()
   WHERE organization_id = org AND email = live_email AND status = 'pending';

  -- ── The tombstone ───────────────────────────────────────────────────────
  UPDATE organization_members
     SET deleted_at = now(),
         is_active  = false,
         status     = 'terminated',
         manager_id = NULL
   WHERE id = target_member;

  removes_auth := NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = target.user_id AND deleted_at IS NULL
  );

  IF removes_auth THEN
    PERFORM public.tombstone_profile(target.user_id);
  END IF;

  -- ── The record of it ────────────────────────────────────────────────────
  --
  -- Written explicitly rather than left to trg_audit, because the audit
  -- trigger records a column diff and what matters here is the identity that
  -- no longer exists to look up.
  INSERT INTO audit_log (
    organization_id, actor_id, action, table_name, record_id, changed_fields,
    old_values, new_values
  ) VALUES (
    org, auth.uid(), 'delete', 'organization_members', target_member,
    ARRAY['deleted_at'],
    jsonb_build_object(
      'email', live_email, 'fullName', prof.full_name,
      'role', target.role, 'status', target.status
    ),
    jsonb_build_object(
      'deleted', true,
      'reassignedTo', reassign_to,
      'reassigned', reassigned,
      'platformIdentityRemoved', removes_auth
    )
  );

  RETURN jsonb_build_object(
    'deleted',          true,
    'memberId',         target_member,
    'email',            live_email,
    'fullName',         prof.full_name,
    'reassignedTo',     reassign_to,
    'reassigned',       reassigned,
    -- Null when the person still belongs to another organization on this
    -- platform, which is the signal to leave their login alone.
    'authUserToDelete', CASE WHEN removes_auth THEN target.user_id ELSE NULL END
  );
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  8b. Ending somebody's sessions
-- ───────────────────────────────────────────────────────────────────────────
--
--  ── Why this is SQL and not one line of supabase-js ───────────────────────
--
--  It looks as though `auth.admin.signOut(userId, 'global')` does this, and it
--  does not: GoTrue's signOut takes the *user's own JWT*, which a server
--  suspending somebody else does not have and must never need. There is no
--  admin "log this user out" endpoint. Called with a user id it fails, and the
--  failure is quiet — the membership change succeeded, so the administrator is
--  told the person is suspended while their browser goes on refreshing a
--  perfectly valid token.
--
--  Deleting the session rows is the operation GoTrue itself performs, and it
--  is the only one reachable from the server. `auth.refresh_tokens` cascades
--  from `auth.sessions`, but tokens predating session tracking have no
--  `session_id`, so both are cleared.
--
--  ── Why not ban the auth user instead ─────────────────────────────────────
--
--  `ban_duration` would also stop them, and would stop them everywhere. This
--  is a multi-tenant platform: one employer suspending someone must not lock
--  them out of a different company's workspace. Sessions are per-login and
--  ending them is what "sign them out" means; banning is a platform-level
--  judgement that no tenant administrator is entitled to make.

CREATE OR REPLACE FUNCTION public.revoke_user_sessions(target_user uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ended int;
BEGIN
  -- varchar in GoTrue's schema, not uuid — the cast is required, not cosmetic.
  DELETE FROM auth.refresh_tokens WHERE user_id = target_user::text;
  DELETE FROM auth.sessions WHERE user_id = target_user;
  GET DIAGNOSTICS ended = ROW_COUNT;
  RETURN ended;
END;
$$;

/**
 * Service role only.
 *
 * A member who could call this could sign any colleague out at will, which is
 * a denial of service with a friendly name. The routes that use it are already
 * behind `authorize('admin', 'manage')`.
 */
REVOKE ALL ON FUNCTION public.revoke_user_sessions(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
--  9. Grants
-- ───────────────────────────────────────────────────────────────────────────
--
--  `tombstone_profile` is deliberately absent: it is SECURITY DEFINER and would
--  let any member disable any account. Only the two functions above and the
--  auth trigger may call it, and they run as the owner.

REVOKE ALL ON FUNCTION public.tombstone_profile(uuid) FROM public, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.account_access_state()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.pending_invitation_for(citext)            TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.member_deletion_impact(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_member_account(uuid, uuid)         TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  10. The directory stops listing the deleted
-- ───────────────────────────────────────────────────────────────────────────
--
--  CREATE OR REPLACE keeps the existing column list and order intact — every
--  dependent view and query is untouched — while adding two columns at the end
--  and, crucially, the WHERE clause. A tombstone is a row that exists so
--  foreign keys resolve, not a colleague.
--
--  Everything down to `presence` is copied verbatim from 0019, which is where
--  this view was last defined; only the final two columns and the WHERE are
--  new. Basing it on 0012's shorter version instead — as this migration first
--  did — drops `client_company_id`, `last_active_at` and `presence`, and
--  Postgres refuses with "cannot drop columns from view" rather than silently
--  breaking the portal and the presence dots.
--
--  `v_assignable_members` and `v_channel_members` need no change: both already
--  join through `om.is_active`, which a tombstone never satisfies.

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
  p.force_password_change,
  p.password_changed_at,
  om.client_company_id,
  p.last_active_at,
  public.presence_of(
    p.presence_status, p.presence_beat_at, p.last_active_at,
    COALESCE((s.value ->> 'awayAfterMinutes')::int, 5),
    COALESCE((s.value ->> 'offlineAfterSeconds')::int, 120)
  )                    AS presence,
  -- New in 0025. The administration screen needs to tell a provisioned account
  -- that has never signed in from one that self-registered, and needs the join
  -- date to show a lifecycle rather than a status word.
  p.account_origin,
  om.joined_at
FROM organization_members om
JOIN profiles p              ON p.id = om.user_id
LEFT JOIN departments d      ON d.id = om.department_id
LEFT JOIN organization_members mgr ON mgr.id = om.manager_id
LEFT JOIN profiles mgr_p     ON mgr_p.id = mgr.user_id
LEFT JOIN org_settings s     ON s.organization_id = om.organization_id
                            AND s.key = 'presence_policy'
WHERE om.deleted_at IS NULL;

COMMENT ON VIEW public.v_org_directory IS
  'Employee directory. Respects RLS via security_invoker. Excludes permanently '
  'deleted accounts, whose membership rows are retained only so that history '
  'resolves.';
