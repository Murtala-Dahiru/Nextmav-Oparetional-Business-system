-- ===========================================================================
--  0036 - Communication that produces work, not only conversation
-- ===========================================================================
--
--  0023 made the module enterprise-grade and 0024 made its unread count true.
--  Both were about the conversation itself. This one is about the four things
--  a conversation *leaves behind*, none of which the schema could hold:
--
--   1. NOTHING COULD BE KEPT. A decision, an address, a set of numbers: all of
--      them scroll away, and the only ways to find them again were pinning
--      (a channel-wide act, visible to everybody, and therefore the wrong tool
--      for "I need this on Thursday") and search (which needs you to remember
--      the words). Section 1 gives a person their own shelf.
--
--   2. EVERY CONVERSATION WAS EQUALLY IMPORTANT. `channel_members` records
--      whether you have muted a room and not whether you live in it, so a
--      sidebar of forty channels can only be ordered by whoever spoke last.
--      Section 2 adds the other half of muting.
--
--   3. A THREAD'S SIZE WAS UNKNOWABLE WITHOUT OPENING IT. `parent_id` has
--      existed since 0003, and the only way to learn that a message had three
--      replies was to fetch them. So the timeline showed a reply affordance on
--      nothing, and a discussion that had moved into a thread looked identical
--      to one nobody had answered. Section 3 answers "how big is this, who is
--      in it, and am I one of them" for a whole channel in one query.
--
--   4. THERE WAS NO ANSWER TO "WHAT NEEDS ME". Mentions were counted per
--      channel and never listed; a reply to something you said produced a
--      notification row and no way back to the sentence it answered; an unread
--      direct message was a number on a row. Section 4 is the personal inbox
--      those three facts add up to.
--
--  Two rules the whole file obeys:
--
--   * Every function here is SECURITY INVOKER apart from the one that was
--     already definer. `messages_select` and `channels_select` decide what a
--     caller may read, and a definer function restating those rules would be a
--     second copy of the access policy living where it is most expensive to
--     get wrong. `channel_overview()` stays definer because it deliberately
--     reports on channels you are *not* in.
--
--   * Nothing here stores message text a second time. A saved message is a
--     pointer; the inbox reads bodies through the policy that governs them.
--     Delete the message and everything built on it goes with it.

-- ---------------------------------------------------------------------------
--  1. A person's own shelf
-- ---------------------------------------------------------------------------
--
--  -- Why this is not a pin --------------------------------------------------
--
--  `messages.is_pinned` is a property of the *channel*: pinning is how a team
--  says "this is the standing information in this room", it shows to everyone,
--  and it is rightly restricted. "I need to come back to this" is a different
--  sentence with an audience of exactly one, and conflating the two produces a
--  pinned list that is either everybody's clutter or nobody's reminder.
--
--  -- Why a note, and why it is optional -------------------------------------
--
--  A saved message six weeks later is a paragraph out of context. One line of
--  your own, "for the Halden renewal", is what makes the list usable; the
--  empty default is what stops it becoming a form to fill in.

CREATE TABLE IF NOT EXISTS message_saves (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  message_id      uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  note            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Saving twice is one shelf entry, not two. The endpoint turns the conflict
  -- into "already saved" rather than into an error.
  UNIQUE (member_id, message_id)
);

-- The list is read newest-first, per person, and never across people.
CREATE INDEX IF NOT EXISTS idx_message_saves_member
  ON message_saves (member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_saves_message
  ON message_saves (message_id);

ALTER TABLE message_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_saves FORCE ROW LEVEL SECURITY;

/**
 * Your shelf is yours, and it cannot outlive your access.
 *
 * Two clauses, and the second is the one that matters: `can_see_channel()` is
 * re-checked on every read, so a message saved out of a channel you were later
 * removed from stops being readable at the same moment the message does. A
 * saved copy that survived the loss of access would be a way to keep reading a
 * private room after leaving it.
 *
 * -- Why FOR ALL is safe here, when it usually is not ----------------------
 *
 * A broad write policy silently grants SELECT, which is how a narrow read rule
 * gets re-opened by a wide write rule elsewhere in this schema. It is safe in
 * this one case because the predicate is *identical* for reading and writing:
 * your own rows, in a channel you can see. There is nothing for the write
 * policy to widen.
 */
DROP POLICY IF EXISTS message_saves_own ON message_saves;
CREATE POLICY message_saves_own ON message_saves FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = public.auth_member_id(organization_id)
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_saves.message_id
        AND m.deleted_at IS NULL
        AND public.can_see_channel(m.channel_id)
    )
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = public.auth_member_id(organization_id)
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_saves.message_id
        AND m.deleted_at IS NULL
        AND public.can_see_channel(m.channel_id)
    )
  );

-- ---------------------------------------------------------------------------
--  2. The other half of muting
-- ---------------------------------------------------------------------------
--
--  `is_muted` says "this room does not concern me". Nothing said the opposite,
--  so a sidebar of forty conversations could only be ordered by whoever spoke
--  last, and the three rooms a person actually lives in sank whenever a busy
--  channel they had joined out of politeness got noisy.
--
--  Per member, not per channel: which conversations matter is a fact about a
--  person, not about a room. It is deliberately not a second unread rule.
--  Starring a channel changes where it sits, never what it counts.

ALTER TABLE channel_members
  ADD COLUMN IF NOT EXISTS is_favourite boolean NOT NULL DEFAULT false;

/**
 * `channel_overview()`, with one more column.
 *
 * Repeated in full because Postgres cannot add a column to a set-returning
 * function's signature in place: `CREATE OR REPLACE` refuses a changed return
 * type, so the function is dropped and rebuilt. Everything below is 0024
 * verbatim apart from `is_favourite`, which comes off the same lateral join as
 * the mute flag and the read marker; there is no second subquery.
 *
 * The ordering is unchanged on purpose. Where a starred conversation sits is a
 * presentation decision and the sidebar groups by it; baking it into the SQL
 * would mean every other caller of this function inherited one screen's idea
 * of order.
 */
DROP FUNCTION IF EXISTS public.channel_overview(uuid);

CREATE FUNCTION public.channel_overview(org uuid)
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
  is_favourite    boolean,
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
     * Unread, counted from the caller's own marker, and only when there is
     * one. `mine.last_read_at` is NULL for a channel the caller has not
     * joined, and the count is then zero rather than "everything", which is
     * what the pre-0024 `COALESCE(..., '-infinity')` made it.
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
    COALESCE(mine.is_favourite, false),
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
  LEFT JOIN LATERAL (
    SELECT cm.member_id, cm.last_read_at, cm.is_muted, cm.is_favourite, cm.role
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

-- ---------------------------------------------------------------------------
--  3. How big a thread is, before opening it
-- ---------------------------------------------------------------------------
--
--  -- The fault this fixes ---------------------------------------------------
--
--  The timeline showed a reply affordance only on messages whose replies it
--  had already fetched, and it fetched replies only when somebody clicked. So
--  a message with eleven answers under it looked exactly like a message nobody
--  had responded to, and the whole thread feature was invisible unless you
--  already knew it was there. Reply counts have to arrive with the timeline.
--
--  One query per channel rather than one per message: forty bubbles must not
--  be forty round trips, which is the same arithmetic that made
--  `channel_overview()` necessary in the first place.
--
--  `i_replied` is what "following a discussion" means here. There is no
--  separate subscription table, deliberately: having said something in a
--  thread is the honest definition of being in it, it needs no upkeep, and it
--  cannot fall out of step with the conversation the way an explicit follow
--  list does.

CREATE INDEX IF NOT EXISTS idx_messages_parent
  ON messages (parent_id, created_at) WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.channel_threads(chan uuid)
RETURNS TABLE (
  root_id          uuid,
  reply_count      int,
  last_reply_at    timestamptz,
  last_sender_name text,
  participants     text[],
  i_replied        boolean
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT public.auth_member_id(c.organization_id) AS id
    FROM channels c WHERE c.id = chan
  )
  SELECT
    r.parent_id,
    COUNT(*)::int,
    MAX(r.created_at),
    (ARRAY_AGG(p.full_name ORDER BY r.created_at DESC))[1],
    /**
     * Who is in the thread, each named once.
     *
     * Capped by the reader rather than here: the array is small, and "and two
     * others" is a presentation decision that belongs with the sentence it
     * appears in.
     */
    ARRAY(
      SELECT DISTINCT p2.full_name
      FROM messages r2
      LEFT JOIN organization_members om2 ON om2.id = r2.sender_id
      LEFT JOIN profiles p2 ON p2.id = om2.user_id
      WHERE r2.parent_id = r.parent_id AND r2.deleted_at IS NULL
        AND p2.full_name IS NOT NULL
    ),
    BOOL_OR(r.sender_id = (SELECT id FROM me))
  FROM messages r
  LEFT JOIN organization_members om ON om.id = r.sender_id
  LEFT JOIN profiles p ON p.id = om.user_id
  WHERE r.channel_id = chan
    AND r.parent_id IS NOT NULL
    AND r.deleted_at IS NULL
  GROUP BY r.parent_id;
$$;

GRANT EXECUTE ON FUNCTION public.channel_threads(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
--  4. What needs me
-- ---------------------------------------------------------------------------
--
--  -- Why this is one function and not three endpoints -----------------------
--
--  "Somebody named me", "somebody answered me" and "somebody wrote to me
--  directly" are three different facts and one question. Answered separately
--  they arrive as three lists a person has to merge in their head, in three
--  round trips, each with its own idea of what "recent" means. Answered
--  together they are an inbox, ordered by time, with the kind as a label.
--
--  -- What is deliberately not in it ----------------------------------------
--
--  Every unread message in every channel. That is the sidebar's job, it is
--  already counted, and an inbox that lists it is a second copy of the whole
--  product with no editorial judgement in it. Three kinds earn their place
--  because each one names a person: you were mentioned, you were answered, you
--  were written to.
--
--  -- Read and unread -------------------------------------------------------
--
--  An inbox that empties completely is one people stop trusting, because the
--  thing they half-remember has vanished with no way back. So it returns what
--  is outstanding *and* a short tail of what has been dealt with, marked
--  `is_unread` so the reader can tell them apart at a glance. "Dealt with" is
--  the same `last_read_at` marker every other count in this module uses; there
--  is no second definition of read anywhere in the product.
--
--  SECURITY INVOKER, so `messages_select` is what decides. A mention in a
--  private channel you have since left returns nothing, without this function
--  having to know that rule exists.

CREATE INDEX IF NOT EXISTS idx_messages_mentions
  ON messages USING gin (mentions) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.communication_inbox(
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
  )
  SELECT
    x.kind,
    x.id,
    x.channel_id,
    COALESCE(
      NULLIF(c.display_name, ''),
      CASE WHEN c.type = 'direct' THEN (
        SELECT p2.full_name
        FROM channel_members cm2
        JOIN organization_members om2 ON om2.id = cm2.member_id
        JOIN profiles p2 ON p2.id = om2.user_id
        WHERE cm2.channel_id = c.id
          AND cm2.member_id IS DISTINCT FROM (SELECT id FROM me)
        LIMIT 1
      ) END,
      '#' || c.name
    ),
    c.type,
    x.parent_id,
    x.body,
    x.sender_id,
    p.full_name,
    x.created_at,
    x.created_at > COALESCE(mine.last_read_at, x.created_at + interval '1 second'),
    EXISTS (SELECT 1 FROM files f WHERE f.message_id = x.id)
  FROM candidates x
  JOIN channels c ON c.id = x.channel_id
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
--  5. The shelf, read back
-- ---------------------------------------------------------------------------
--
--  A saved message needs the same three facts a search hit needs: where it was
--  said, by whom, and when. Resolving a direct conversation's name is the part
--  no caller should write for itself, so it is the same expression as
--  `message_search()` and `communication_inbox()`. Third and last copy; a
--  fourth caller should make it a function of its own.

CREATE OR REPLACE FUNCTION public.saved_messages(org uuid, lim int DEFAULT 100)
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
    COALESCE(
      NULLIF(c.display_name, ''),
      CASE WHEN c.type = 'direct' THEN (
        SELECT p2.full_name
        FROM channel_members cm2
        JOIN organization_members om2 ON om2.id = cm2.member_id
        JOIN profiles p2 ON p2.id = om2.user_id
        WHERE cm2.channel_id = c.id
          AND cm2.member_id IS DISTINCT FROM public.auth_member_id(org)
        LIMIT 1
      ) END,
      '#' || c.name
    ),
    c.type,
    m.parent_id,
    m.body,
    m.sender_id,
    p.full_name,
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

-- ---------------------------------------------------------------------------
--  6. Realtime
-- ---------------------------------------------------------------------------
--
--  Saving is a personal act on one device, and the reason it is published is
--  the second device: somebody who saves a message on a laptop and has the
--  same shelf open on a phone should not have to reload. Filtered to the
--  caller's own rows in the browser, as `channel_members` is.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_saves'] LOOP
    -- REPLICA IDENTITY FULL so a DELETE arrives with enough of the row to
    -- match a filter on a non-key column.
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
