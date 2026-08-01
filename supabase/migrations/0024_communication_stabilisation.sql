-- ═══════════════════════════════════════════════════════════════════════════
--  0024 — Unread that is true, and a meeting that announces itself
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Two faults found while auditing the communication module end to end. Both
--  are the same kind: a number that was computed correctly from the wrong
--  premise, and an event that happened with nobody told about it.
--
--  ── 1. A conversation you are not in cannot be unread ────────────────────
--
--  `channel_overview()` derives the unread count from the caller's
--  `channel_members.last_read_at`, and falls back to `-infinity` when there is
--  no membership row. For a member that fallback never fires — the column is
--  `NOT NULL DEFAULT now()`, so joining a channel starts the clock at the
--  moment you joined and the history behind you is not "unread".
--
--  But the channel list deliberately includes channels you are *not* in: every
--  public and announcement channel in the organisation, so they can be found
--  and joined, plus — for an administrator — every non-direct channel. For all
--  of those there is no membership row, the fallback does fire, and the count
--  becomes "every message ever posted here".
--
--  The visible result is a company where #general carries a badge of 340,
--  #announcements one of 96, and the navigation badge is the sum of every
--  message in every room nobody has joined. It cannot be cleared, because
--  there is no row to mark read: the endpoint that marks a channel read
--  updates `channel_members` and correctly answers 404 for somebody who is not
--  a member. A badge that cannot be cleared is worse than no badge — it is the
--  thing that teaches people to ignore all of them.
--
--  Unread means "said to me since I last looked". A room you have never
--  entered has not said anything to you. Both counts are therefore zero
--  without a membership row, and the fallback is gone rather than made
--  cleverer — there is no longer a case in which it would be right.
--
--  The rest of the function is unchanged and is repeated verbatim because
--  Postgres has no way to replace one column of a set-returning function.
--
--  ── 2. A meeting that starts, and the twelve people who were invited ─────
--
--  `notify_meeting_invite()` (0023) tells somebody they have been invited. A
--  scheduled meeting then sits until its time, and the moment that actually
--  matters — the host walking in and starting it — produced no notification at
--  all. Everybody who was invited had to happen to be looking at Communication
--  to know.
--
--  So the start is announced, through `notify_members()` like everything else,
--  which means the organisation's notification settings still govern it and
--  the host is not notified of their own act. Only for people who were invited
--  and have not arrived: telling the four people already in the room that the
--  room they are in has started is noise.

-- ───────────────────────────────────────────────────────────────────────────
--  1. Unread, for members only
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.channel_overview(org uuid)
RETURNS TABLE (
  channel_id      uuid,
  name            text,
  display_name    text,
  description     text,
  topic           text,
  type            channel_type,
  post_policy     text,
  join_policy     text,
  is_archived     boolean,
  created_by      uuid,
  member_count    int,
  message_count   int,
  unread_count    int,
  pinned_count    int,
  is_member       boolean,
  is_admin        boolean,
  is_muted        boolean,
  my_role         text,
  last_message    text,
  last_message_at timestamptz,
  last_sender     text,
  counterpart_id   uuid,
  counterpart_name text,
  counterpart_avatar text,
  project_id      uuid,
  project_name    text,
  company_id      uuid,
  company_name    text,
  department_id   uuid,
  department_name text,
  live_meeting_id uuid,
  mention_count   int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT public.auth_member_id(org) AS id),
  visible AS (
    SELECT c.*
    FROM channels c, me
    WHERE c.organization_id = org
      AND public.can_access_module(org, 'communication')
      AND (
        c.type IN ('public', 'announcement')
        OR EXISTS (SELECT 1 FROM channel_members cm
                   WHERE cm.channel_id = c.id AND cm.member_id = me.id)
        OR (c.type <> 'direct' AND public.is_org_admin(org))
      )
  )
  SELECT
    v.id,
    v.name,
    v.display_name,
    v.description,
    v.topic,
    v.type,
    v.post_policy,
    v.join_policy,
    v.is_archived,
    v.created_by,
    (SELECT COUNT(*)::int FROM channel_members cm WHERE cm.channel_id = v.id),
    (SELECT COUNT(*)::int FROM messages m WHERE m.channel_id = v.id AND m.deleted_at IS NULL),
    /**
     * Unread, counted from the caller's own marker — and only when there is
     * one. `mine.last_read_at` is NULL for a channel the caller has not
     * joined, and the count is zero rather than "everything", which is what
     * the old `COALESCE(…, '-infinity')` made it.
     */
    COALESCE((
      SELECT COUNT(*)::int FROM messages m
       WHERE m.channel_id = v.id
         AND m.deleted_at IS NULL
         AND m.sender_id IS DISTINCT FROM me.id
         AND m.created_at > mine.last_read_at
    ), 0),
    (SELECT COUNT(*)::int FROM messages m
      WHERE m.channel_id = v.id AND m.deleted_at IS NULL AND m.is_pinned = true),
    mine.member_id IS NOT NULL,
    public.is_channel_admin(v.id),
    COALESCE(mine.is_muted, false),
    mine.role,
    last_msg.body,
    last_msg.created_at,
    last_msg.sender_name,
    dm.member_id,
    dm.full_name,
    dm.avatar_url,
    v.project_id,
    pr.name,
    v.company_id,
    co.name,
    v.department_id,
    dp.name,
    (SELECT mt.id FROM meetings mt
      WHERE mt.channel_id = v.id AND mt.status = 'live'
      ORDER BY mt.started_at DESC LIMIT 1),
    -- A mention in a room you are not in is the same non-event, for the same
    -- reason: nothing could have named you before you could read it.
    COALESCE((
      SELECT COUNT(*)::int FROM messages m
       WHERE m.channel_id = v.id
         AND m.deleted_at IS NULL
         AND me.id = ANY (m.mentions)
         AND m.created_at > mine.last_read_at
    ), 0)
  FROM visible v
  CROSS JOIN me
  LEFT JOIN projects    pr ON pr.id = v.project_id
  LEFT JOIN companies   co ON co.id = v.company_id
  LEFT JOIN departments dp ON dp.id = v.department_id
  /**
   * The caller's own membership, joined once.
   *
   * It was five correlated subqueries against `channel_members` — the marker,
   * the mute flag, the role, and `is_member` twice over. One lateral join says
   * the same thing, and makes "is there a row at all?" a value the counts
   * above can be written against instead of a fallback each of them has to
   * remember to get right.
   */
  LEFT JOIN LATERAL (
    SELECT cm.member_id, cm.last_read_at, cm.is_muted, cm.role
    FROM channel_members cm
    WHERE cm.channel_id = v.id AND cm.member_id = me.id
  ) mine ON true
  LEFT JOIN LATERAL (
    SELECT m.body, m.created_at, p.full_name AS sender_name
    FROM messages m
    LEFT JOIN organization_members om ON om.id = m.sender_id
    LEFT JOIN profiles p ON p.id = om.user_id
    WHERE m.channel_id = v.id AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC
    LIMIT 1
  ) last_msg ON true
  LEFT JOIN LATERAL (
    SELECT cm.member_id, p.full_name, p.avatar_url
    FROM channel_members cm
    JOIN organization_members om ON om.id = cm.member_id
    JOIN profiles p ON p.id = om.user_id
    WHERE v.type = 'direct'
      AND cm.channel_id = v.id
      AND cm.member_id IS DISTINCT FROM me.id
    LIMIT 1
  ) dm ON true
  ORDER BY COALESCE(last_msg.created_at, v.created_at) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.channel_overview(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  2. A meeting that starts tells the people who were invited to it
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_meeting_started()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  audience uuid[];
BEGIN
  -- Only the transition, and only into `live`. A meeting whose title is edited
  -- while it runs must not announce itself again.
  IF NEW.status <> 'live' OR OLD.status = 'live' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(mp.member_id)
    INTO audience
    FROM meeting_participants mp
   WHERE mp.meeting_id = NEW.id
     -- Everybody who was expected and is not here. Somebody already in the
     -- room does not need to be told the room has opened, and somebody who
     -- declined has answered already.
     AND mp.state IN ('invited', 'admitted');

  IF audience IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.notify_members(
    NEW.organization_id,
    audience,
    'meeting',
    NEW.title || ' has started',
    '',
    'meeting',
    NEW.id,
    '/dashboard?module=communication'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meetings_notify_started ON meetings;
CREATE TRIGGER meetings_notify_started
  AFTER UPDATE OF status ON meetings
  FOR EACH ROW EXECUTE FUNCTION public.notify_meeting_started();
