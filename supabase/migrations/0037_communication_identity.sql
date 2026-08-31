-- ===========================================================================
--  0037 - One face, everywhere, and an inbox that knows about announcements
-- ===========================================================================
--
--  -- 1. The avatar that never arrived --------------------------------------
--
--  `profiles.avatar_url` has been on the profile since 0001 and is uploaded
--  through the account screen. The sidebar renders it, CRM renders it,
--  Projects and Workspace render it. Communication - the one module that is
--  entirely about who is speaking - rendered coloured initials for every
--  person on every surface, because nothing in this module ever asked for the
--  column and three of its five read paths never returned it.
--
--  So a person who uploads a photograph sees it in five places and not in the
--  one place their colleagues actually look at them. This migration returns
--  the avatar from the three functions that were dropping it; the components
--  are the other half of the fix.
--
--  -- 2. The label expression, extracted ------------------------------------
--
--  "What is this conversation called, from where you are standing" is three
--  clauses and one correlated subquery, and 0036 already carried the third
--  copy of it with a note saying a fourth caller should make it a function.
--  This is the fourth caller. `channel_label_for()` is now the only place that
--  rule is written.
--
--  -- 3. Announcements are attention ----------------------------------------
--
--  `communication_inbox()` returned three kinds: mentioned, answered, written
--  to. An announcement channel is the fourth thing that legitimately needs
--  somebody: it is broadcast, it is restricted to administrators by
--  `post_policy`, and it is the mechanism a company uses when everybody has to
--  know. It was reaching people only as a badge on a sidebar row.
--
--  It is deliberately last in the union and unmuteable in the same way a
--  mention is not: muting an announcement channel still silences its count,
--  because muting is a real preference, but an unread announcement is listed.
--
--  Everything else about these three functions is unchanged. They are repeated
--  in full because Postgres cannot add a column to a set-returning function's
--  signature in place.

-- ---------------------------------------------------------------------------
--  1. What a conversation is called, from where you are standing
-- ---------------------------------------------------------------------------
--
--  A channel's own name, or - for a direct conversation, which has none - the
--  other participant. Never the `dm-<uuid>-<uuid>` slug, which is exactly what
--  must not reach a screen.
--
--  SECURITY INVOKER: it reads `channels` and `channel_members`, both of which
--  are under RLS, so a caller who cannot see a conversation gets NULL rather
--  than its name. The callers all join `channels` themselves anyway, so this
--  can only ever narrow.

CREATE OR REPLACE FUNCTION public.channel_label_for(chan uuid, viewer uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(c.display_name, ''),
    CASE WHEN c.type = 'direct' THEN (
      SELECT p.full_name
      FROM channel_members cm
      JOIN organization_members om ON om.id = cm.member_id
      JOIN profiles p ON p.id = om.user_id
      WHERE cm.channel_id = c.id
        AND cm.member_id IS DISTINCT FROM viewer
      LIMIT 1
    ) END,
    '#' || c.name
  )
  FROM channels c
  WHERE c.id = chan;
$$;

GRANT EXECUTE ON FUNCTION public.channel_label_for(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
--  2. Search, with the face of whoever said it
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.message_search(uuid, text, int);

CREATE FUNCTION public.message_search(org uuid, q text, lim int DEFAULT 40)
RETURNS TABLE (
  message_id    uuid,
  channel_id    uuid,
  channel_label text,
  channel_type  channel_type,
  parent_id     uuid,
  body          text,
  sender_id     uuid,
  sender_name   text,
  sender_avatar text,
  created_at    timestamptz,
  rank          real
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH tsq AS (SELECT public.search_tsquery(q) AS query),
       me  AS (SELECT public.auth_member_id(org) AS id)
  SELECT
    m.id,
    m.channel_id,
    public.channel_label_for(m.channel_id, me.id),
    c.type,
    m.parent_id,
    m.body,
    m.sender_id,
    p.full_name,
    p.avatar_url,
    m.created_at,
    ts_rank(to_tsvector('english', m.body), tsq.query)
  FROM messages m
  JOIN channels c              ON c.id = m.channel_id
  LEFT JOIN organization_members om ON om.id = m.sender_id
  LEFT JOIN profiles p         ON p.id = om.user_id,
       tsq, me
  WHERE m.organization_id = org
    AND m.deleted_at IS NULL
    AND tsq.query IS NOT NULL
    AND to_tsvector('english', m.body) @@ tsq.query
  ORDER BY ts_rank(to_tsvector('english', m.body), tsq.query) DESC, m.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(lim, 40), 100));
$$;

GRANT EXECUTE ON FUNCTION public.message_search(uuid, text, int) TO authenticated;

-- ---------------------------------------------------------------------------
--  3. The inbox: four kinds, and a face on each
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.communication_inbox(uuid, int, int);

CREATE FUNCTION public.communication_inbox(
  org uuid,
  lim int DEFAULT 40,
  since_days int DEFAULT 30
)
RETURNS TABLE (
  kind          text,
  message_id    uuid,
  channel_id    uuid,
  channel_label text,
  channel_type  channel_type,
  parent_id     uuid,
  body          text,
  sender_id     uuid,
  sender_name   text,
  sender_avatar text,
  created_at    timestamptz,
  is_unread     boolean,
  has_files     boolean
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT public.auth_member_id(org) AS id),
  window_start AS (
    SELECT now() - (GREATEST(1, LEAST(COALESCE(since_days, 30), 180)) || ' days')::interval AS from_at
  ),
  /**
   * The caller's own membership row per channel, once.
   *
   * `last_read_at` is what makes `is_unread` mean the same thing here as it
   * does on the sidebar badge. A channel with no row, a public room the caller
   * has never joined, contributes nothing: nothing can have named you before
   * you could read it, which is the rule 0024 established.
   */
  mine AS (
    SELECT cm.channel_id, cm.last_read_at
    FROM channel_members cm, me
    WHERE cm.member_id = me.id
  ),
  candidates AS (
    -- Named. The one kind that reaches a person through a muted channel.
    SELECT 'mention'::text AS kind, m.*
    FROM messages m, me, window_start w
    WHERE m.organization_id = org
      AND m.deleted_at IS NULL
      AND m.created_at >= w.from_at
      AND me.id = ANY (m.mentions)
      AND m.sender_id IS DISTINCT FROM me.id

    UNION ALL

    -- Answered. A reply to something the caller said.
    SELECT 'reply'::text, m.*
    FROM messages m
    JOIN messages root ON root.id = m.parent_id
    CROSS JOIN me CROSS JOIN window_start w
    WHERE m.organization_id = org
      AND m.deleted_at IS NULL
      AND m.created_at >= w.from_at
      AND root.sender_id = me.id
      AND m.sender_id IS DISTINCT FROM me.id
      -- A mention inside a reply is already above, and one row per message is
      -- what stops the inbox showing the same sentence twice.
      AND NOT (me.id = ANY (m.mentions))

    UNION ALL

    -- Written to. Direct conversations only, and only the other person's side.
    SELECT 'direct'::text, m.*
    FROM messages m
    JOIN channels c ON c.id = m.channel_id
    CROSS JOIN me CROSS JOIN window_start w
    WHERE m.organization_id = org
      AND m.deleted_at IS NULL
      AND m.created_at >= w.from_at
      AND c.type = 'direct'
      AND m.sender_id IS DISTINCT FROM me.id
      AND NOT (me.id = ANY (m.mentions))

    UNION ALL

    /**
     * Told. An announcement channel is how a company says something everybody
     * has to know, and it was reaching people only as a number on a sidebar
     * row.
     *
     * Restricted to channels the caller is actually a member of, so an
     * announcement channel nobody has joined does not fill the inbox with its
     * whole history - the same rule the unread count follows since 0024.
     */
    SELECT 'announcement'::text, m.*
    FROM messages m
    JOIN channels c ON c.id = m.channel_id
    JOIN channel_members cm ON cm.channel_id = c.id
    CROSS JOIN me CROSS JOIN window_start w
    WHERE m.organization_id = org
      AND m.deleted_at IS NULL
      AND m.created_at >= w.from_at
      AND c.type = 'announcement'
      AND cm.member_id = me.id
      AND m.sender_id IS DISTINCT FROM me.id
      AND m.parent_id IS NULL
      AND NOT (me.id = ANY (m.mentions))
  )
  SELECT
    x.kind,
    x.id,
    x.channel_id,
    public.channel_label_for(x.channel_id, me.id),
    c.type,
    x.parent_id,
    x.body,
    x.sender_id,
    p.full_name,
    p.avatar_url,
    x.created_at,
    x.created_at > COALESCE(mine.last_read_at, x.created_at + interval '1 second'),
    EXISTS (SELECT 1 FROM files f WHERE f.message_id = x.id)
  FROM candidates x
  JOIN channels c ON c.id = x.channel_id
  CROSS JOIN me
  LEFT JOIN mine ON mine.channel_id = x.channel_id
  LEFT JOIN organization_members om ON om.id = x.sender_id
  LEFT JOIN profiles p ON p.id = om.user_id
  ORDER BY
    -- Outstanding first, then newest. Both halves stay in time order within
    -- themselves, which is what makes this readable as an inbox rather than as
    -- a ranked feed nobody can predict.
    (x.created_at > COALESCE(mine.last_read_at, x.created_at + interval '1 second')) DESC,
    x.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(lim, 40), 200));
$$;

GRANT EXECUTE ON FUNCTION public.communication_inbox(uuid, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
--  4. The shelf, with faces
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.saved_messages(uuid, int);

CREATE FUNCTION public.saved_messages(org uuid, lim int DEFAULT 100)
RETURNS TABLE (
  save_id       uuid,
  note          text,
  saved_at      timestamptz,
  message_id    uuid,
  channel_id    uuid,
  channel_label text,
  channel_type  channel_type,
  parent_id     uuid,
  body          text,
  sender_id     uuid,
  sender_name   text,
  sender_avatar text,
  created_at    timestamptz,
  has_files     boolean
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    s.id,
    s.note,
    s.created_at,
    m.id,
    m.channel_id,
    public.channel_label_for(m.channel_id, public.auth_member_id(org)),
    c.type,
    m.parent_id,
    m.body,
    m.sender_id,
    p.full_name,
    p.avatar_url,
    m.created_at,
    EXISTS (SELECT 1 FROM files f WHERE f.message_id = m.id)
  FROM message_saves s
  JOIN messages m  ON m.id = s.message_id AND m.deleted_at IS NULL
  JOIN channels c  ON c.id = m.channel_id
  LEFT JOIN organization_members om ON om.id = m.sender_id
  LEFT JOIN profiles p ON p.id = om.user_id
  WHERE s.organization_id = org
  ORDER BY s.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(lim, 100), 500));
$$;

GRANT EXECUTE ON FUNCTION public.saved_messages(uuid, int) TO authenticated;
