-- ═══════════════════════════════════════════════════════════════════════════
--  Two defects that only appear on a real Supabase project
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Both were invisible to db:verify because neither path is exercised there:
--  nothing in that harness issues an invitation, and nothing updates a message.
--
--  ── 1. gen_random_bytes() is not on the search_path ──────────────────────
--
--  0001 opens with `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`, which reads
--  as though it puts pgcrypto in `public`. On a Supabase project it does not:
--  pgcrypto is already installed in the `extensions` schema, so IF NOT EXISTS
--  matches, the statement is a no-op, and the extension stays where it was.
--
--  Nothing notices until a function with a locked-down search_path calls one
--  of its symbols. invite_to_organization() is declared
--  `SET search_path = public, pg_temp` — correct hardening for a SECURITY
--  DEFINER function, and exactly what stops it resolving
--  extensions.gen_random_bytes(). Every invitation fails with
--
--      42883: function gen_random_bytes(integer) does not exist
--
--  gen_random_uuid() masks the problem, because since PostgreSQL 13 that one
--  lives in pg_catalog and resolves from anywhere. gen_random_bytes() is
--  still pgcrypto-only.
--
--  Fixed by schema-qualifying the call sites rather than by widening the
--  search_path: an explicit `extensions.` cannot later be broken by someone
--  tightening the search_path again, and it keeps the hardening intact.
--
--  ── 2. A trigger writing a column that does not exist ────────────────────
--
--  public.messages records edits in `edited_at`, not `updated_at` — a message
--  is edited, and the distinction is visible to users ("edited" markers).
--  But trg_set_updated_at was attached to it anyway, and set_updated_at()
--  assigns NEW.updated_at unconditionally, so every UPDATE aborts with
--
--      42703: record "new" has no field "updated_at"
--
--  which takes out editing, pinning and soft-deleting a message. INSERT was
--  unaffected, so posting worked and the table looked healthy.
--
--  Dropped rather than papered over by adding an updated_at column: the
--  column the table already has is the right one, and adding a second
--  timestamp would leave two sources of truth for when a message changed.

-- ── 1. Invitation tokens ───────────────────────────────────────────────────

-- The column default runs in the inserting statement's search_path, which for
-- an insert from invite_to_organization() is that function's. Qualify it too.
ALTER TABLE public.invitations
  ALTER COLUMN token SET DEFAULT encode(extensions.gen_random_bytes(32), 'hex');

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
    token         = encode(extensions.gen_random_bytes(32), 'hex'),
    expires_at    = now() + interval '7 days',
    invited_by    = auth.uid(),
    updated_at    = now()
  RETURNING * INTO inv;

  RETURN inv;
END;
$$;

-- ── 2. messages.updated_at ─────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.messages;
