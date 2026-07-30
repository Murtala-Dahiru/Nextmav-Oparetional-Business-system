-- ═══════════════════════════════════════════════════════════════════════════
--  0019 — Presence that reflects activity rather than account age
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ── What was wrong ───────────────────────────────────────────────────────
--
--  `profiles.last_seen_at` is declared `NOT NULL DEFAULT now()`, so it is
--  stamped once when the profile row is created and never again. 0006 added a
--  `touch_presence()` function to update it — and nothing has ever called it,
--  from any route, component or script.
--
--  So the column holds the moment the account was created, for ever. Two
--  visible consequences:
--
--    · The Admin and HR tables' "Last Seen" column shows the signup date for
--      every employee, permanently. Somebody who has used the product daily
--      for six months reads as last seen six months ago.
--
--    · `online_members()` and the communication header's "online" count filter
--      on `last_seen_at > now() - interval '5 minutes'`, which is true only in
--      the five minutes immediately after signup. The count is therefore
--      almost always zero, and was previously a hard-coded 4.
--
--  ── Why a heartbeat rather than a single timestamp ───────────────────────
--
--  "Online" cannot be derived from one column. A single `last_seen_at` cannot
--  distinguish three states that matter:
--
--    · at the keyboard now
--    · connected but idle for twenty minutes
--    · gone — browser closed, laptop shut, network dropped
--
--  The first two differ by *activity*; the second and third differ by whether
--  the connection is still there. So the client reports its own status, and
--  the server derives liveness from how recently that report arrived:
--
--    last_active_at        the last genuine interaction — pointer, key, focus
--    presence_status       what the client last reported: online | away
--    presence_beat_at      when that report arrived, whatever it said
--    last_seen_at          unchanged in meaning: the last time we saw them
--
--  Effective presence is computed, never stored. A browser that crashes never
--  gets to say "offline", so a stored status would leave that person online for
--  ever — which is exactly the failure everyone has seen in a chat product.
--  A stale heartbeat is offline regardless of what was last reported.
--
--  Everything here is additive. `last_seen_at` keeps its name, its type and its
--  meaning, so the four views that already select it are unaffected.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
--  1. The columns
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS presence_status text NOT NULL DEFAULT 'offline';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS presence_beat_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_presence_status_valid') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_presence_status_valid
      CHECK (presence_status IN ('online', 'away', 'offline'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.last_active_at IS
  'The last genuine interaction — a pointer move, a keystroke, the tab being '
  'focused. Distinct from the heartbeat, which continues while somebody is idle '
  'with the tab open. This is what "away for 20 minutes" is measured from.';

COMMENT ON COLUMN public.profiles.presence_status IS
  'What the client last reported: online or away. Never read on its own — a '
  'crashed browser never reports offline, so effective presence also requires '
  'a recent presence_beat_at. See v_presence.';

COMMENT ON COLUMN public.profiles.presence_beat_at IS
  'When the last heartbeat arrived. A stale one means the connection is gone, '
  'whatever the last reported status said.';

/**
 * Backfilled to NULL rather than now().
 *
 * An existing profile has never sent a heartbeat, and pretending otherwise
 * would show the whole company as online the moment this deploys. NULL reads as
 * offline, which is both true and the safe default.
 */
CREATE INDEX IF NOT EXISTS idx_profiles_presence
  ON profiles (presence_beat_at DESC) WHERE presence_beat_at IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────────
--  2. How long until away, and until offline
-- ───────────────────────────────────────────────────────────────────────────
--
--  Configurable, as asked, and stored where every other policy lives so the
--  administration screen can reach it through the same endpoint.
--
--  The defaults are chosen against the client's heartbeat interval rather than
--  picked round: the browser beats every 45 seconds, so 120 seconds is two
--  missed beats plus slack — long enough that one dropped request does not
--  flicker somebody offline, short enough that a closed laptop is reflected
--  within about two minutes.

INSERT INTO org_settings (organization_id, key, value)
SELECT o.id, 'presence_policy',
       jsonb_build_object(
         'awayAfterMinutes', 5,
         'offlineAfterSeconds', 120,
         'showPresenceToClients', false
       )
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM org_settings s
  WHERE s.organization_id = o.id AND s.key = 'presence_policy'
);


-- ───────────────────────────────────────────────────────────────────────────
--  3. Recording a heartbeat
-- ───────────────────────────────────────────────────────────────────────────
--
--  Replaces `touch_presence()` from 0006, which is kept as a thin wrapper so
--  anything that ever starts calling it still works.

CREATE OR REPLACE FUNCTION public.record_presence(
  p_status text DEFAULT 'online',
  p_active boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  status text;
BEGIN
  -- An unrecognised status is treated as 'online' rather than rejected: a
  -- heartbeat is not worth failing a request over, and the constraint would
  -- otherwise turn a client bug into a 500 on every beat.
  status := CASE WHEN p_status IN ('online', 'away', 'offline') THEN p_status ELSE 'online' END;

  UPDATE profiles
  SET presence_status  = status,
      presence_beat_at = now(),
      /**
       * `last_seen_at` moves on every beat: it means "the last time we saw
       * them", and an idle tab is still a signed-in person.
       *
       * `last_active_at` moves only on a genuine interaction, which is what
       * makes "away" measurable. Signing off explicitly does not count as
       * activity either, so a leaving user's last_active_at stays honest.
       */
      last_seen_at     = now(),
      last_active_at   = CASE
                           WHEN p_active AND status <> 'offline' THEN now()
                           ELSE last_active_at
                         END
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_presence(text, boolean) TO authenticated;

/**
 * The 0006 signature, preserved.
 *
 * It was never called, but removing a granted function is the kind of change
 * that breaks something nobody remembered was there.
 */
CREATE OR REPLACE FUNCTION public.touch_presence()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.record_presence('online', true);
$$;

GRANT EXECUTE ON FUNCTION public.touch_presence() TO authenticated;

/**
 * Signing out is a definite offline, not a stale heartbeat.
 *
 * Distinguished from a dropped connection because it is knowable: waiting two
 * minutes to grey out somebody who deliberately signed off looks broken.
 */
CREATE OR REPLACE FUNCTION public.clear_presence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE profiles
  SET presence_status  = 'offline',
      presence_beat_at = now(),
      last_seen_at     = now()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_presence() TO authenticated;


-- ───────────────────────────────────────────────────────────────────────────
--  4. Effective presence, in one place
-- ───────────────────────────────────────────────────────────────────────────
--
--  Every screen that shows a dot has to agree about what it means, so the
--  derivation lives here and nowhere else — the same argument that put progress
--  in v_project_health.
--
--  `security_invoker`, like every other view here. `profiles_select` from 0005
--  already admits a row when the profile belongs to somebody in an organization
--  the caller is a member of, so the policy alone gives the right answer and the
--  explicit organization filter below is the readable, index-friendly statement
--  of the same rule rather than the thing enforcing it.
--
--  Writing it as a definer view would have worked and would have been wrong:
--  the check in `check-migrations-consistency` that flagged it exists precisely
--  to stop a view quietly becoming the one place RLS does not apply.

CREATE OR REPLACE FUNCTION public.presence_of(
  p_status   text,
  p_beat_at  timestamptz,
  p_active_at timestamptz,
  p_away_after_minutes int DEFAULT 5,
  p_offline_after_seconds int DEFAULT 120
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- Never beat, or the connection has gone quiet: offline, whatever was said.
    WHEN p_beat_at IS NULL THEN 'offline'
    WHEN p_beat_at < now() - make_interval(secs => p_offline_after_seconds) THEN 'offline'
    -- The client said so.
    WHEN p_status = 'offline' THEN 'offline'
    WHEN p_status = 'away' THEN 'away'
    -- Beating and claiming to be online, but nothing has actually happened for
    -- a while. Catches a tab left open on a second monitor, which the client
    -- may not have noticed going idle.
    WHEN p_active_at IS NULL THEN 'away'
    WHEN p_active_at < now() - make_interval(mins => p_away_after_minutes) THEN 'away'
    ELSE 'online'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.presence_of(text, timestamptz, timestamptz, int, int) TO authenticated;

CREATE OR REPLACE VIEW public.v_presence
WITH (security_invoker = true) AS
SELECT
  om.organization_id,
  om.id            AS member_id,
  p.id             AS user_id,
  p.full_name,
  p.avatar_url,
  p.last_seen_at,
  p.last_active_at,
  p.presence_beat_at,
  p.presence_status AS reported_status,
  public.presence_of(
    p.presence_status,
    p.presence_beat_at,
    p.last_active_at,
    COALESCE((s.value ->> 'awayAfterMinutes')::int, 5),
    COALESCE((s.value ->> 'offlineAfterSeconds')::int, 120)
  )                AS presence
FROM organization_members om
JOIN profiles p ON p.id = om.user_id
LEFT JOIN org_settings s
  ON s.organization_id = om.organization_id AND s.key = 'presence_policy'
WHERE om.is_active
  -- Presence is disclosed only inside an organization the caller belongs to.
  AND om.organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND is_active
  );

COMMENT ON VIEW public.v_presence IS
  'Effective presence per member: online, away or offline, derived from the '
  'reported status, the heartbeat and the last real interaction, against the '
  'organization''s configured windows. The single definition — every screen '
  'showing a presence dot reads this, so none of them can disagree.';

GRANT SELECT ON public.v_presence TO authenticated;

/**
 * `online_members()` from 0006, corrected.
 *
 * It filtered on `last_seen_at > now() - interval '5 minutes'` against a column
 * nothing updated, so it returned people only in the minutes after they signed
 * up. Same signature and same columns; the definition of "online" now comes
 * from the one place that defines it.
 */
CREATE OR REPLACE FUNCTION public.online_members(org uuid)
RETURNS TABLE (member_id uuid, user_id uuid, full_name text, avatar_url text, last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT v.member_id, v.user_id, v.full_name, v.avatar_url, v.last_seen_at
  FROM public.v_presence v
  WHERE v.organization_id = org
    AND v.presence = 'online';
$$;

GRANT EXECUTE ON FUNCTION public.online_members(uuid) TO authenticated;


-- ───────────────────────────────────────────────────────────────────────────
--  5. Presence is live
-- ───────────────────────────────────────────────────────────────────────────
--
--  A dot that only changes on reload is worse than no dot: it asserts something
--  current about somebody who left an hour ago.
--
--  `profiles` is published so a heartbeat reaches other tabs. It carries no
--  business data beyond a name and an avatar, and RLS still decides who
--  receives a row.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    EXECUTE 'ALTER TABLE public.profiles REPLICA IDENTITY FULL';
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles';
    END IF;
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
--  6. Presence on the views the screens already read
-- ───────────────────────────────────────────────────────────────────────────
--
--  Every people-shaped screen already reads one of three views. Appending the
--  verdict to each means an avatar gets its dot from the query it was already
--  making, rather than every screen fetching `/api/presence` separately and
--  the two disagreeing while one of them is in flight.
--
--  `CREATE OR REPLACE VIEW` permits adding columns at the end and nothing else,
--  so each definition is restated in full with the new columns appended — the
--  same constraint 0016 worked within when it added `client_company_id`.
--
--  `presence_of()` is called rather than reimplemented: three copies of a CASE
--  expression is three chances for the directory and the chat to disagree about
--  what "away" means.

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
  -- Added in 0016. Null for every employee; set only on client logins.
  om.client_company_id,
  -- Added in 0019.
  p.last_active_at,
  public.presence_of(
    p.presence_status, p.presence_beat_at, p.last_active_at,
    COALESCE((s.value ->> 'awayAfterMinutes')::int, 5),
    COALESCE((s.value ->> 'offlineAfterSeconds')::int, 120)
  )                    AS presence
FROM organization_members om
JOIN profiles p              ON p.id = om.user_id
LEFT JOIN departments d      ON d.id = om.department_id
LEFT JOIN organization_members mgr ON mgr.id = om.manager_id
LEFT JOIN profiles mgr_p     ON mgr_p.id = mgr.user_id
LEFT JOIN org_settings s     ON s.organization_id = om.organization_id
                            AND s.key = 'presence_policy';

CREATE OR REPLACE VIEW public.v_assignable_members
WITH (security_invoker = true) AS
SELECT
  om.id            AS member_id,
  om.organization_id,
  om.role,
  om.department_id,
  d.name           AS department_name,
  p.id             AS user_id,
  COALESCE(NULLIF(btrim(p.full_name), ''), split_part(p.email::text, '@', 1))
                   AS full_name,
  p.email,
  p.avatar_url,
  p.job_title,
  -- Added in 0019.
  p.last_seen_at,
  p.last_active_at,
  public.presence_of(
    p.presence_status, p.presence_beat_at, p.last_active_at,
    COALESCE((s.value ->> 'awayAfterMinutes')::int, 5),
    COALESCE((s.value ->> 'offlineAfterSeconds')::int, 120)
  )                AS presence
FROM organization_members om
JOIN profiles p          ON p.id = om.user_id
LEFT JOIN departments d  ON d.id = om.department_id
LEFT JOIN org_settings s ON s.organization_id = om.organization_id
                        AND s.key = 'presence_policy'
WHERE om.is_active = true
  AND om.role <> 'client';

CREATE OR REPLACE VIEW public.v_channel_members
WITH (security_invoker = true) AS
SELECT
  cm.id,
  cm.channel_id,
  cm.member_id,
  cm.role,
  cm.is_muted,
  cm.last_read_at,
  cm.joined_at,
  c.organization_id,
  p.full_name,
  p.avatar_url,
  p.email,
  p.job_title,
  p.last_seen_at,
  om.role       AS org_role,
  d.name        AS department_name,
  -- Added in 0019.
  p.last_active_at,
  public.presence_of(
    p.presence_status, p.presence_beat_at, p.last_active_at,
    COALESCE((s.value ->> 'awayAfterMinutes')::int, 5),
    COALESCE((s.value ->> 'offlineAfterSeconds')::int, 120)
  )             AS presence
FROM channel_members cm
JOIN channels c                   ON c.id = cm.channel_id
JOIN organization_members om      ON om.id = cm.member_id
JOIN profiles p                   ON p.id = om.user_id
LEFT JOIN departments d           ON d.id = om.department_id
LEFT JOIN org_settings s          ON s.organization_id = c.organization_id
                                 AND s.key = 'presence_policy';

GRANT SELECT ON public.v_org_directory      TO authenticated;
GRANT SELECT ON public.v_assignable_members TO authenticated;
GRANT SELECT ON public.v_channel_members    TO authenticated;
