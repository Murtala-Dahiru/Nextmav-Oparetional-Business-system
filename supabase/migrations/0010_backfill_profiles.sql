-- ═══════════════════════════════════════════════════════════════════════════
--  Backfill profiles for accounts that predate the trigger
-- ═══════════════════════════════════════════════════════════════════════════
--
--  0001 creates handle_new_user() and the on_auth_user_created trigger, so
--  every account created *after* that migration ran gets a profile row in the
--  same transaction as the auth.users insert.
--
--  It does nothing for accounts that already existed. Supabase Auth is usually
--  in use before the schema is applied — you sign up to test the project long
--  before the migrations are finished — so on any real database a set of users
--  predates the trigger and has no profile.
--
--  Those accounts are not merely incomplete, they are stuck. organization_
--  members.user_id references profiles(id), so create_organization() inserts
--  the membership, hits the foreign key, and fails with 23503. The API reports
--  it as "A referenced record does not exist." The user can sign in, confirm
--  their email, and never create an organization — with an error that points
--  at nothing they can act on.
--
--  A trigger that maintains an invariant going forward needs a backfill for
--  the rows already there. This is that backfill.
--
--  Idempotent, so it is safe on every re-apply and a no-op on a fresh
--  database where the trigger has always been present.

INSERT INTO public.profiles (id, email, first_name, last_name, avatar_url)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data ->> 'first_name', ''),
  COALESCE(u.raw_user_meta_data ->> 'last_name', ''),
  u.raw_user_meta_data ->> 'avatar_url'
FROM auth.users u
WHERE
  -- profiles.email is NOT NULL; phone-only and anonymous accounts have none
  -- and cannot be represented, so they are left alone rather than failing the
  -- whole migration.
  u.email IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
  -- profiles.email is citext UNIQUE. A row already holding this address under
  -- a different id would turn the insert into a unique violation, which
  -- ON CONFLICT (id) does not catch. Skip it and leave the conflict visible
  -- rather than aborting the migration.
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.email = u.email)
ON CONFLICT (id) DO NOTHING;
