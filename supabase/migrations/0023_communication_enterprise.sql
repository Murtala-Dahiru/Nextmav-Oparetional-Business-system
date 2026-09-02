-- ═══════════════════════════════════════════════════════════════════════════
--  0023 — Communication, to an enterprise standard
-- ═══════════════════════════════════════════════════════════════════════════
--
--  0017 made the module usable: a channel could be created, joined, renamed
--  and left, and a private one stopped announcing itself to the whole company.
--  What it left is a chat application that happens to live inside a business
--  operating system rather than a communication layer *of* one.
--
--  Five things were missing, and each of them is the difference between
--  "messaging" and "communication at work":
--
--   1. A CONVERSATION HAS NO SUBJECT. `channels.department_id` and `team_id`
--      have existed since 0003 and nothing has ever set them. There is no way
--      to say "this channel is the Northwind account" or "this is where the
--      Atlas rebuild is discussed", so a conversation cannot be opened from
--      the project it is about, and the project cannot be opened from it.
--      Section 1 gives a channel a project and a client company, and section 8
--      returns them on the overview so the header can link both ways.
--
--   2. NOTHING CAN BE ATTACHED. `messages.attachments` is a jsonb column the
--      endpoint has accepted since the first migration; the composer has never
--      sent it and no bubble has ever rendered it, so it has been `[]` on
--      every message ever posted. Worse, storing a filename in it would have
--      been the wrong shape anyway — a file in a private channel needs the
--      same governance as a file anywhere else in the product. Section 2
--      attaches chat files to the `files` table, where they are findable,
--      attributable and revocable, and narrows `files_select`, which until now
--      let any employee read the name of a file posted in a private channel.
--
--   3. READ RECEIPTS WERE A BROADCAST, NOT A QUESTION. The bubble rendered
--      "Read by Ada, Grace" under every message its author sent, which is both
--      noisy and, in a channel of forty people, a small act of surveillance
--      performed on everybody by default. Section 3 makes it something the
--      sender asks for: one function, callable only by the person who sent the
--      message, returning who has seen it and when.
--
--   4. SEARCH STOPPED AT THE OPEN CONVERSATION. The module filtered the
--      hundred messages it had already loaded. Anything older, or in another
--      channel, was unreachable. Section 4 is a real index and a search that
--      respects RLS, so it returns exactly what the caller may read.
--
--   5. THERE WAS NOWHERE TO MEET. Every "meeting" in the product was a
--      calendar event with a location string. Section 6 gives a meeting a
--      room: a host, a waiting room, participants with hands and microphones,
--      a lock, notes, and a link back to the channel and project it belongs
--      to. Signalling for the media itself is broadcast, not stored — see the
--      note in section 6.
--
--  Also here: a moderation trail (section 5) that deliberately records no
--  message text, an organisation-level communication policy (section 7), and
--  the narrowing of one rule that has been wrong since 0017 — an organisation
--  administrator's sidebar listed every direct message in the company.

-- ───────────────────────────────────────────────────────────────────────────
--  1. A conversation belongs to something
-- ───────────────────────────────────────────────────────────────────────────
--
--  A channel already had a department and a team it could belong to. The two
--  subjects people actually organise work around — a project and a client —
--  had nowhere to go.
--
--  Both are `ON DELETE SET NULL` rather than CASCADE: deleting a project must
--  not take its conversation and its decisions with it. The channel survives
--  as an ordinary channel, which is what an archive is for.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_channels_project ON channels (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channels_company ON channels (company_id) WHERE company_id IS NOT NULL;

/**
 * May the caller see this channel at all?
 *
 * The same three-part rule as `channels_select`, extracted so that everything
 * hanging off a channel — its files, its meetings — is governed by one
 * definition rather than three copies that drift.
 *
 * Note what it does *not* say: an organisation administrator is not admitted
 * to a direct message. See the narrowing at the end of this section.
 */
CREATE OR REPLACE FUNCTION public.can_see_channel(chan uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM channels c
    WHERE c.id = chan
      AND c.organization_id = ANY (public.auth_org_ids())
      AND public.can_access_module(c.organization_id, 'communication')
      AND (
        c.type IN ('public', 'announcement')
        OR public.is_channel_member(c.id)
        OR (c.type <> 'direct' AND public.is_org_admin(c.organization_id))
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_see_channel(uuid) TO authenticated;

/**
 * An administrator does not get everybody's private conversations in their
 * sidebar.
 *
 * 0017 admitted `is_org_admin(organization_id)` to every channel row, which
 * was written to give administration a way to manage channels and had the
 * side effect of listing every direct message in the company — with both
 * participants' names — in the owner's Messages list, and of making
 * `is_channel_admin()` true for those conversations, which carries the right
 * to delete them.
 *
 * Administration of *channels* is a real need and is preserved: an
 * administrator still sees, manages and can delete every public, private and
 * announcement channel. A direct message between two colleagues is not a
 * channel anybody administers.
 */
DROP POLICY IF EXISTS channels_select ON channels;
CREATE POLICY channels_select ON channels FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_access_module(organization_id, 'communication')
    AND (
      type IN ('public', 'announcement')
      OR public.is_channel_member(id)
      OR (type <> 'direct' AND public.is_org_admin(organization_id))
    )
  );

/**
 * The same narrowing, one level down.
 *
 * `is_channel_admin()` is what `channels_update`, `channels_delete` and
 * `can_post_to_channel()` all consult. Leaving the organisation-admin branch
 * in place would mean the row is invisible and still deletable, which is a
 * worse state than either.
 */
CREATE OR REPLACE FUNCTION public.is_channel_admin(chan uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM channels c
    WHERE c.id = chan
      AND (
        (c.type <> 'direct' AND public.is_org_admin(c.organization_id))
        OR c.created_by = public.auth_member_id(c.organization_id)
        OR EXISTS (
          SELECT 1 FROM channel_members cm
          WHERE cm.channel_id = c.id
            AND cm.member_id = public.auth_member_id(c.organization_id)
            AND cm.role IN ('owner', 'admin')
        )
      )
  );
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  2. Attachments are files, not a jsonb blob
-- ───────────────────────────────────────────────────────────────────────────
--
--  The obvious implementation of "attach a file to a message" is to put the
--  bucket and path in `messages.attachments` and render from it. It works
--  until somebody asks any of the questions an organisation eventually asks:
--  what has this person uploaded, how much storage is this channel using,
--  remove this file everywhere it appears. None of those can be answered from
--  a jsonb array scattered across a message table.
--
--  `files` already answers all of them — it is what the workspace, projects,
--  tickets and expenses attach through. A chat attachment is a file whose
--  subject is a message.
--
--  `messages.attachments` keeps its name and changes its job: it now holds
--  *references to business records* — a task, a workspace page, a project, an
--  invoice — which are not files and have no bytes. Section 9 documents the
--  shape.

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES channels(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_files_message ON files (message_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_channel ON files (channel_id) WHERE deleted_at IS NULL;

/**
 * A file posted in a private channel is as private as the channel.
 *
 * `files_select` admits every non-confidential file in the organisation. That
 * was defensible while every file belonged to a workspace page or a project,
 * both of which are organisation-visible. It is not defensible for a file
 * dropped into a private HR channel: its name, its size and its uploader would
 * have been readable by every employee through the workspace's own file list.
 *
 * The added clause is deliberately shaped as "a file with no channel behaves
 * exactly as before", so nothing that already worked changes.
 */
DROP POLICY IF EXISTS files_select ON files;
CREATE POLICY files_select ON files FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      is_confidential = false
      OR member_id = public.auth_member_id(organization_id)
      OR public.has_org_role(organization_id, ARRAY['owner','administrator','hr_staff']::org_role[])
    )
    AND (channel_id IS NULL OR public.can_see_channel(channel_id))
  );

-- ───────────────────────────────────────────────────────────────────────────
--  3. Read receipts, asked for rather than announced
-- ───────────────────────────────────────────────────────────────────────────
--
--  ── Why there is still no receipts table ─────────────────────────────────
--
--  The instinct is a row per (message, reader). That is one write per person
--  per message read — on a channel of forty people reading a hundred messages,
--  four thousand rows for a fact that is already known: `last_read_at` on the
--  membership drives the unread badge, and a member whose marker is at or past
--  a message has read it. A separate table would be a second answer to the
--  same question, and the two would disagree the first time one was updated
--  without the other.
--
--  ── Why it is a function and not a column on the message ─────────────────
--
--  Because it is a question, not a property. The brief is explicit: a message
--  must not wear "Seen by Ada, Grace" the moment somebody opens the channel.
--  This is called when the sender asks, and only for them.

CREATE OR REPLACE FUNCTION public.message_receipts(msg uuid)
RETURNS TABLE (
  member_id    uuid,
  full_name    text,
  avatar_url   text,
  job_title    text,
  read_at      timestamptz,
  has_read     boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m record;
  me uuid;
BEGIN
  SELECT id, organization_id, channel_id, sender_id, created_at
    INTO m
    FROM messages
   WHERE id = msg AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  me := public.auth_member_id(m.organization_id);

  /**
   * Only the author.
   *
   * "Who has read this" is a question about something you said. Letting a
   * third party ask it about somebody else's message turns a conversation into
   * a reading log, which is the thing the brief asks to avoid.
   */
  IF me IS NULL OR me <> m.sender_id THEN
    RAISE EXCEPTION 'Only the author of a message can see who has read it.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    cm.member_id,
    p.full_name,
    p.avatar_url,
    p.job_title,
    -- The marker is the moment they last read the channel, which for a message
    -- they have read is the earliest instant we can honestly claim.
    CASE WHEN cm.last_read_at >= m.created_at THEN cm.last_read_at END,
    cm.last_read_at >= m.created_at
  FROM channel_members cm
  JOIN organization_members om ON om.id = cm.member_id
  JOIN profiles p              ON p.id = om.user_id
  WHERE cm.channel_id = m.channel_id
    AND cm.member_id <> m.sender_id
  ORDER BY (cm.last_read_at >= m.created_at) DESC, cm.last_read_at DESC, p.full_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.message_receipts(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  4. Search that reaches past the open conversation
-- ───────────────────────────────────────────────────────────────────────────
--
--  ── Invoker, not definer ─────────────────────────────────────────────────
--
--  Every other function in this migration is SECURITY DEFINER, because each
--  one needs to read something the caller cannot. This one must not be: the
--  whole correctness of a search across every conversation is that
--  `messages_select` decides what comes back. A definer function would have to
--  re-implement that policy, and a search index is exactly the wrong place to
--  keep a second copy of an access rule.

CREATE INDEX IF NOT EXISTS idx_messages_fts
  ON messages USING gin (to_tsvector('english', body))
  WHERE deleted_at IS NULL;

/**
 * Turn what somebody typed into a tsquery, with the last word left open.
 *
 * Searching a chat is a live gesture — people type "quart" and expect
 * "quarterly" while they are still typing. `plainto_tsquery` cannot express
 * that, so the terms are assembled by hand with `:*` on each one. Everything
 * that is not a letter or a digit is dropped rather than escaped: the input is
 * a search box, and a stray `&` reaching `to_tsquery` is a syntax error thrown
 * at somebody who was typing a company name.
 */
CREATE OR REPLACE FUNCTION public.search_tsquery(q text)
RETURNS tsquery
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  terms text;
BEGIN
  SELECT string_agg(s.cleaned || ':*', ' & ')
    INTO terms
    FROM (
      SELECT regexp_replace(word, '[^a-z0-9]', '', 'g') AS cleaned
      FROM unnest(regexp_split_to_array(lower(btrim(coalesce(q, ''))), '\s+')) AS word
    ) s
   WHERE s.cleaned <> '';

  IF terms IS NULL OR terms = '' THEN
    RETURN NULL;
  END IF;
  RETURN to_tsquery('english', terms);
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_tsquery(text) TO authenticated;

/**
 * Find a message anywhere the caller can read.
 *
 * Returns the conversation's display label alongside each hit, because a
 * result that says only "…the numbers are in the deck" without saying where it
 * was said is not a result anybody can act on. For a direct message the label
 * is the other person, resolved the same way the sidebar resolves it — never
 * the `dm-<uuid>-<uuid>` slug.
 */
/*
   Dropped rather than replaced.

   `db:apply` replays every migration in order, and 0037 widens this
   function's return type. On a replay against a database that has reached
   that migration, `CREATE OR REPLACE` fails with "cannot change return type
   of existing function" and takes every later file with it. The drop makes
   the file runnable from any starting point; the wider version is recreated
   a few files later.
*/
DROP FUNCTION IF EXISTS public.message_search(uuid, text, int);
CREATE OR REPLACE FUNCTION public.message_search(org uuid, q text, lim int DEFAULT 40)
RETURNS TABLE (
  message_id    uuid,
  channel_id    uuid,
  channel_label text,
  channel_type  channel_type,
  parent_id     uuid,
  body          text,
  sender_id     uuid,
  sender_name   text,
  created_at    timestamptz,
  rank          real
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH tsq AS (SELECT public.search_tsquery(q) AS query)
  SELECT
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
    ts_rank(to_tsvector('english', m.body), tsq.query)
  FROM messages m
  JOIN channels c              ON c.id = m.channel_id
  LEFT JOIN organization_members om ON om.id = m.sender_id
  LEFT JOIN profiles p         ON p.id = om.user_id,
       tsq
  WHERE m.organization_id = org
    AND m.deleted_at IS NULL
    AND tsq.query IS NOT NULL
    AND to_tsvector('english', m.body) @@ tsq.query
  ORDER BY ts_rank(to_tsvector('english', m.body), tsq.query) DESC, m.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(lim, 40), 100));
$$;

GRANT EXECUTE ON FUNCTION public.message_search(uuid, text, int) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  5. A moderation trail that records no conversation
-- ───────────────────────────────────────────────────────────────────────────
--
--  ── The trap this table is shaped around ─────────────────────────────────
--
--  The obvious audit row carries what was removed: "deleted message: 'the
--  Q3 numbers are …'". That copies the contents of a private channel into a
--  table administrators read, which defeats the RLS on the message that was
--  the point of moderating it. The same mistake put an expense title into the
--  organisation-wide activity feed on 2026-07-31.
--
--  So this table records the *act* and never the words: who did what, in which
--  channel, to which message id, and why. Reconstructing what was said is
--  deliberately impossible from here.

CREATE TABLE IF NOT EXISTS communication_audit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id         uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  action           text NOT NULL,
  channel_id       uuid REFERENCES channels(id) ON DELETE SET NULL,
  -- Not a foreign key on purpose: the message this refers to has usually just
  -- been removed, and an audit entry that disappears with its subject is not
  -- an audit entry.
  message_id       uuid,
  target_member_id uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  reason           text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_audit_org
  ON communication_audit (organization_id, created_at DESC);

ALTER TABLE communication_audit ENABLE ROW LEVEL SECURITY;
-- FORCE as well as ENABLE: without it the policies are skipped for the table's
-- owner, and the migration role owns every table here.
ALTER TABLE communication_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comm_audit_select ON communication_audit;
CREATE POLICY comm_audit_select ON communication_audit FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.is_org_admin(organization_id)
  );

/**
 * No INSERT policy, deliberately.
 *
 * An audit trail anybody may write is not evidence of anything. The only way
 * in is the function below, which takes the actor from the session rather than
 * from its arguments.
 */
CREATE OR REPLACE FUNCTION public.log_communication_event(
  org        uuid,
  p_action   text,
  p_channel  uuid DEFAULT NULL,
  p_message  uuid DEFAULT NULL,
  p_target   uuid DEFAULT NULL,
  p_reason   text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me  uuid := public.auth_member_id(org);
  new_id uuid;
BEGIN
  IF me IS NULL THEN
    RETURN NULL;
  END IF;

  -- A short, closed vocabulary. An audit table whose `action` is free text
  -- cannot be filtered, counted or trusted a year later.
  IF p_action NOT IN (
    'message_deleted', 'message_edited', 'message_pinned', 'message_unpinned',
    'channel_created', 'channel_archived', 'channel_deleted', 'channel_settings_changed',
    'member_added', 'member_removed', 'member_role_changed',
    'policy_changed', 'retention_applied',
    'meeting_started', 'meeting_ended', 'participant_removed'
  ) THEN
    RAISE EXCEPTION 'Unknown communication audit action: %', p_action
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO communication_audit (
    organization_id, actor_id, action, channel_id, message_id, target_member_id, reason
  )
  VALUES (org, me, p_action, p_channel, p_message, p_target, left(coalesce(p_reason, ''), 500))
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.log_communication_event(uuid, text, uuid, uuid, uuid, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  6. Meetings
-- ───────────────────────────────────────────────────────────────────────────
--
--  ── What is stored, and what is not ──────────────────────────────────────
--
--  Stored: everything an organisation needs to be able to answer questions
--  about later — who called the meeting, when it ran, who was in the room, who
--  was still waiting outside, what was agreed. That is a business record.
--
--  Not stored: anything to do with the media. The offer/answer exchange and
--  the ICE candidates that connect two browsers are worthless three seconds
--  after they are sent and would otherwise be a row per candidate per pair of
--  participants. They travel over Realtime broadcast on `meeting:<id>`, which
--  is the same reasoning as the typing indicator in `use-realtime.ts`: a fact
--  that expires on its own does not belong in a table with a cleanup job.
--
--  ── Why the participant row exists at all, then ──────────────────────────
--
--  Because the *control* surface is not ephemeral and must not be trusted to
--  the browser. "The host muted you", "you have not been admitted", "the
--  meeting is locked" are decisions that have to survive a reconnect and hold
--  even against a client that ignores them — a participant who has not been
--  admitted must not be able to receive the stream by simply not honouring a
--  broadcast message. The row is the authority; the broadcast is the transport.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_status') THEN
    CREATE TYPE meeting_status AS ENUM ('scheduled', 'live', 'ended', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS meetings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Where the meeting belongs. A meeting with a channel is discoverable by
  -- that channel's members and its notes land back in the conversation.
  channel_id       uuid REFERENCES channels(id) ON DELETE SET NULL,
  project_id       uuid REFERENCES projects(id) ON DELETE SET NULL,
  -- The calendar entry, so a scheduled meeting is in everybody's week rather
  -- than only inside this module.
  event_id         uuid REFERENCES calendar_events(id) ON DELETE SET NULL,
  title            text NOT NULL CHECK (btrim(title) <> ''),
  agenda           text NOT NULL DEFAULT '',
  host_id          uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  status           meeting_status NOT NULL DEFAULT 'scheduled',
  mode             text NOT NULL DEFAULT 'video' CHECK (mode IN ('video', 'audio')),
  scheduled_at     timestamptz,
  duration_minutes int NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 1440),
  started_at       timestamptz,
  ended_at         timestamptz,
  -- Host controls.
  is_locked        boolean NOT NULL DEFAULT false,
  waiting_room     boolean NOT NULL DEFAULT true,
  -- Whether an external client account may be invited. Off by default: a
  -- customer in an internal meeting has to be a decision somebody made.
  allow_guests     boolean NOT NULL DEFAULT false,
  notes            text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_org
  ON meetings (organization_id, scheduled_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_meetings_channel ON meetings (channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_live    ON meetings (organization_id) WHERE status = 'live';

CREATE TABLE IF NOT EXISTS meeting_participants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id     uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_id      uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
  role           text NOT NULL DEFAULT 'attendee'
                 CHECK (role IN ('host', 'cohost', 'attendee')),
  /**
   * Where this person is in the room.
   *
   *   invited   — on the list, not here
   *   knocking  — at the door, waiting room is on
   *   admitted  — let in, not yet connected
   *   joined    — in the room
   *   left      — was here, has gone
   *   removed   — put out by the host; may not knock again
   *   declined  — said no to the invitation
   */
  state          text NOT NULL DEFAULT 'invited'
                 CHECK (state IN ('invited', 'knocking', 'admitted', 'joined', 'left', 'removed', 'declined')),
  invited_at     timestamptz NOT NULL DEFAULT now(),
  knocked_at     timestamptz,
  admitted_at    timestamptz,
  joined_at      timestamptz,
  left_at        timestamptz,
  -- Set by the host. The participant's own microphone state is theirs and
  -- lives in the browser; this is the enforced one.
  is_muted       boolean NOT NULL DEFAULT false,
  camera_on      boolean NOT NULL DEFAULT false,
  is_sharing     boolean NOT NULL DEFAULT false,
  hand_raised_at timestamptz,
  UNIQUE (meeting_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_member
  ON meeting_participants (member_id);

/** May the caller see this meeting? */
CREATE OR REPLACE FUNCTION public.can_see_meeting(m uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM meetings mt
    WHERE mt.id = m
      AND mt.organization_id = ANY (public.auth_org_ids())
      AND public.can_access_module(mt.organization_id, 'communication')
      AND (
        mt.host_id = public.auth_member_id(mt.organization_id)
        OR EXISTS (
          SELECT 1 FROM meeting_participants mp
          WHERE mp.meeting_id = mt.id
            AND mp.member_id = public.auth_member_id(mt.organization_id)
        )
        -- A meeting attached to a conversation is visible to that
        -- conversation, which is how a team meeting is discoverable without
        -- everybody having to be invited individually.
        OR (mt.channel_id IS NOT NULL AND public.can_see_channel(mt.channel_id))
      )
  );
$$;

/** Does the caller run this meeting? */
CREATE OR REPLACE FUNCTION public.is_meeting_host(m uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM meetings mt
    WHERE mt.id = m
      AND (
        mt.host_id = public.auth_member_id(mt.organization_id)
        OR EXISTS (
          SELECT 1 FROM meeting_participants mp
          WHERE mp.meeting_id = mt.id
            AND mp.member_id = public.auth_member_id(mt.organization_id)
            AND mp.role IN ('host', 'cohost')
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_see_meeting(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_meeting_host(uuid)  TO authenticated;

ALTER TABLE meetings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings             FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting_participants FORCE ROW LEVEL SECURITY;

/**
 * ── Why this repeats `can_see_meeting()` instead of calling it ───────────
 *
 * `can_see_meeting(id)` reads the `meetings` row it is asked about. As a
 * policy on any *other* table that is exactly right, and it is used that way
 * below. As the SELECT policy on `meetings` itself it is subtly broken, in a
 * way that only shows up on one path:
 *
 *   INSERT INTO meetings (…) RETURNING id
 *
 * `RETURNING` requires SELECT on the new row, so this policy runs — and the
 * function inside it opens its own query against `meetings`, which uses the
 * current command's snapshot and therefore cannot see the row this very
 * command is inserting. The predicate returns false and Postgres refuses the
 * statement with "new row violates row-level security policy", naming the
 * INSERT policy that in fact passed.
 *
 * Written against the row's own columns, the same rule evaluates against the
 * row in hand and the problem disappears. The two must be kept in step; the
 * duplication is deliberate and this comment is the reason for it.
 */
DROP POLICY IF EXISTS meetings_select ON meetings;
CREATE POLICY meetings_select ON meetings FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_access_module(organization_id, 'communication')
    AND (
      host_id = public.auth_member_id(organization_id)
      OR EXISTS (
        SELECT 1 FROM meeting_participants mp
        WHERE mp.meeting_id = meetings.id
          AND mp.member_id = public.auth_member_id(meetings.organization_id)
      )
      OR (channel_id IS NOT NULL AND public.can_see_channel(channel_id))
    )
  );

DROP POLICY IF EXISTS meetings_insert ON meetings;
CREATE POLICY meetings_insert ON meetings FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_access_module(organization_id, 'communication')
    -- You call your own meetings. Scheduling one in somebody else's name is
    -- not a thing this product does.
    AND host_id = public.auth_member_id(organization_id)
  );

DROP POLICY IF EXISTS meetings_update ON meetings;
CREATE POLICY meetings_update ON meetings FOR UPDATE TO authenticated
  USING (public.is_meeting_host(id) OR public.is_org_admin(organization_id))
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

DROP POLICY IF EXISTS meetings_delete ON meetings;
CREATE POLICY meetings_delete ON meetings FOR DELETE TO authenticated
  USING (
    host_id = public.auth_member_id(organization_id)
    OR public.is_org_admin(organization_id)
  );

DROP POLICY IF EXISTS meeting_participants_select ON meeting_participants;
CREATE POLICY meeting_participants_select ON meeting_participants FOR SELECT TO authenticated
  USING (public.can_see_meeting(meeting_id));

/**
 * Getting into a meeting.
 *
 * Two admissible cases, and no third:
 *   · the host (or a co-host) invites somebody, or
 *   · you put yourself at the door of a meeting you can already see.
 *
 * The second is what makes a channel meeting joinable without an invitation
 * each time. It cannot be used to appoint yourself host, because the role is
 * checked here rather than trusted from the insert.
 */
DROP POLICY IF EXISTS meeting_participants_insert ON meeting_participants;
CREATE POLICY meeting_participants_insert ON meeting_participants FOR INSERT TO authenticated
  WITH CHECK (
    public.is_meeting_host(meeting_id)
    OR (
      public.can_see_meeting(meeting_id)
      AND role = 'attendee'
      AND EXISTS (
        SELECT 1 FROM meetings mt
        WHERE mt.id = meeting_id
          AND mt.is_locked = false
          AND member_id = public.auth_member_id(mt.organization_id)
      )
    )
  );

/**
 * Changing a participant.
 *
 * The host may mute, admit, promote and remove. Everybody else may change
 * their own row — raise a hand, turn a camera on, leave — and the WITH CHECK
 * is what stops that being used to promote yourself: a non-host update must
 * leave `role` as it found it.
 */
DROP POLICY IF EXISTS meeting_participants_update ON meeting_participants;
CREATE POLICY meeting_participants_update ON meeting_participants FOR UPDATE TO authenticated
  USING (
    public.is_meeting_host(meeting_id)
    OR EXISTS (
      SELECT 1 FROM meetings mt
      WHERE mt.id = meeting_id
        AND member_id = public.auth_member_id(mt.organization_id)
    )
  )
  WITH CHECK (
    public.is_meeting_host(meeting_id)
    OR (
      role = 'attendee'
      AND EXISTS (
        SELECT 1 FROM meetings mt
        WHERE mt.id = meeting_id
          AND member_id = public.auth_member_id(mt.organization_id)
      )
    )
  );

DROP POLICY IF EXISTS meeting_participants_delete ON meeting_participants;
CREATE POLICY meeting_participants_delete ON meeting_participants FOR DELETE TO authenticated
  USING (
    public.is_meeting_host(meeting_id)
    OR EXISTS (
      SELECT 1 FROM meetings mt
      WHERE mt.id = meeting_id
        AND member_id = public.auth_member_id(mt.organization_id)
    )
  );

/**
 * The host is a participant of their own meeting.
 *
 * Written by a trigger rather than by the endpoint, so it also holds for a
 * meeting created by a future import, a template, or a recurring series. A
 * meeting whose host is not in the participant list has nobody who can admit
 * anyone.
 */
CREATE OR REPLACE FUNCTION public.seed_meeting_host()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO meeting_participants (meeting_id, member_id, role, state)
  VALUES (NEW.id, NEW.host_id, 'host', 'invited')
  ON CONFLICT (meeting_id, member_id) DO UPDATE SET role = 'host';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meetings_seed_host ON meetings;
CREATE TRIGGER meetings_seed_host
  AFTER INSERT ON meetings
  FOR EACH ROW EXECUTE FUNCTION public.seed_meeting_host();

/**
 * A meeting on the calendar.
 *
 * The brief asks for calendar integration, and the honest form of that is not
 * a second calendar inside this module — it is a row in `calendar_events`, so
 * a meeting appears in the week view, in the dashboard's "today" panel and in
 * everything else that already reads the calendar. The event is created and
 * kept in step by this trigger rather than by the endpoint, for the same
 * reason as above.
 */
CREATE OR REPLACE FUNCTION public.sync_meeting_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ev uuid;
BEGIN
  -- Only a scheduled meeting belongs on a calendar. An ad-hoc call started
  -- from a channel has no future to plan around.
  IF NEW.scheduled_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.event_id IS NULL THEN
    INSERT INTO calendar_events (
      organization_id, title, description, starts_at, ends_at,
      location, colour, visibility, project_id, created_by
    )
    VALUES (
      NEW.organization_id,
      NEW.title,
      NEW.agenda,
      NEW.scheduled_at,
      NEW.scheduled_at + make_interval(mins => NEW.duration_minutes),
      'NextMav meeting',
      '#6366f1',
      'organization',
      NEW.project_id,
      NEW.host_id
    )
    RETURNING id INTO ev;

    UPDATE meetings SET event_id = ev WHERE id = NEW.id;
  ELSE
    UPDATE calendar_events
       SET title       = NEW.title,
           description = NEW.agenda,
           starts_at   = NEW.scheduled_at,
           ends_at     = NEW.scheduled_at + make_interval(mins => NEW.duration_minutes),
           project_id  = NEW.project_id,
           updated_at  = now()
     WHERE id = NEW.event_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meetings_sync_event ON meetings;
CREATE TRIGGER meetings_sync_event
  AFTER INSERT OR UPDATE OF title, agenda, scheduled_at, duration_minutes, project_id ON meetings
  FOR EACH ROW EXECUTE FUNCTION public.sync_meeting_event();

/**
 * Everything a meeting list needs, in one query.
 *
 * The same reasoning as `channel_overview()`: without it a list of ten
 * meetings is eleven round trips, and the counts each one shows are the sort
 * of derived value a client will compute three different ways.
 */
CREATE OR REPLACE FUNCTION public.meeting_overview(org uuid)
RETURNS TABLE (
  meeting_id       uuid,
  title            text,
  agenda           text,
  status           meeting_status,
  mode             text,
  scheduled_at     timestamptz,
  duration_minutes int,
  started_at       timestamptz,
  ended_at         timestamptz,
  is_locked        boolean,
  waiting_room     boolean,
  allow_guests     boolean,
  notes            text,
  host_id          uuid,
  host_name        text,
  channel_id       uuid,
  channel_label    text,
  project_id       uuid,
  project_name     text,
  event_id         uuid,
  invited_count    int,
  present_count    int,
  knocking_count   int,
  my_role          text,
  my_state         text,
  am_host          boolean
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT public.auth_member_id(org) AS id)
  SELECT
    m.id, m.title, m.agenda, m.status, m.mode,
    m.scheduled_at, m.duration_minutes, m.started_at, m.ended_at,
    m.is_locked, m.waiting_room, m.allow_guests, m.notes,
    m.host_id, hp.full_name,
    m.channel_id,
    COALESCE(NULLIF(c.display_name, ''), CASE WHEN c.name IS NOT NULL THEN '#' || c.name END),
    m.project_id, pr.name,
    m.event_id,
    (SELECT COUNT(*)::int FROM meeting_participants mp WHERE mp.meeting_id = m.id),
    (SELECT COUNT(*)::int FROM meeting_participants mp
      WHERE mp.meeting_id = m.id AND mp.state = 'joined'),
    (SELECT COUNT(*)::int FROM meeting_participants mp
      WHERE mp.meeting_id = m.id AND mp.state = 'knocking'),
    mine.role, mine.state,
    (m.host_id = me.id OR mine.role IN ('host', 'cohost'))
  -- `CROSS JOIN me` rather than `, me`: a comma puts `me` and the next LEFT
  -- JOIN into their own join tree, and the ON clause then cannot see `m` at
  -- all. An explicit cross join keeps everything on one level.
  FROM meetings m
  CROSS JOIN me
  LEFT JOIN organization_members hom ON hom.id = m.host_id
  LEFT JOIN profiles hp              ON hp.id  = hom.user_id
  LEFT JOIN channels c               ON c.id   = m.channel_id
  LEFT JOIN projects pr              ON pr.id  = m.project_id
  LEFT JOIN LATERAL (
    SELECT mp.role, mp.state FROM meeting_participants mp
    WHERE mp.meeting_id = m.id AND mp.member_id = me.id
  ) mine ON true
  WHERE m.organization_id = org
  ORDER BY
    -- Live first, then what is coming, then what has been.
    CASE m.status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
    COALESCE(m.scheduled_at, m.created_at) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.meeting_overview(uuid) TO authenticated;

/**
 * Who is in the room, for the participant panel.
 *
 * `security_invoker`, so `meeting_participants_select` decides what comes
 * back and this view cannot become a way around it.
 */
DROP VIEW IF EXISTS public.v_meeting_participants CASCADE;
CREATE VIEW public.v_meeting_participants
WITH (security_invoker = true) AS
SELECT
  mp.id,
  mp.meeting_id,
  mp.member_id,
  mp.role,
  mp.state,
  mp.invited_at,
  mp.knocked_at,
  mp.admitted_at,
  mp.joined_at,
  mp.left_at,
  mp.is_muted,
  mp.camera_on,
  mp.is_sharing,
  mp.hand_raised_at,
  p.full_name,
  p.avatar_url,
  p.email,
  p.job_title,
  om.role AS org_role,
  d.name  AS department_name
FROM meeting_participants mp
JOIN organization_members om ON om.id = mp.member_id
JOIN profiles p              ON p.id  = om.user_id
LEFT JOIN departments d      ON d.id  = om.department_id;

GRANT SELECT ON public.v_meeting_participants TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  7. The organisation's communication policy
-- ───────────────────────────────────────────────────────────────────────────
--
--  Added to `default_org_settings()` so a new organisation has it, and
--  backfilled below so the existing ones do too. Both are needed; a key added
--  after a backfill has run reaches nobody, and a key only in the backfill
--  reaches nobody created afterwards.

CREATE OR REPLACE FUNCTION public.default_communication_policy()
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    -- Who may open a new channel. 'admins' is for organisations that curate
    -- their channel list; 'everyone' is the default because a company where
    -- starting a conversation needs permission stops having them.
    'channel_creation',        'everyone',
    -- Whether a message may be edited after sending, and for how long.
    -- 0 minutes means "for ever", which is what the module has always done.
    'allow_message_edit',      true,
    'edit_window_minutes',     0,
    -- Whether the author may delete their own message. Channel and
    -- organisation administrators always can; this is about the author.
    'allow_message_delete',    true,
    -- How long messages are kept. 0 is for ever. Anything else is applied by
    -- `apply_message_retention()`, deliberately on demand rather than by a
    -- background job nobody can see running.
    'retention_days',          0,
    -- Whether an external client account may be admitted to a meeting.
    'allow_client_meetings',   false,
    -- Largest file that may be posted in a conversation, in megabytes. Capped
    -- by the `attachments` bucket's own 25MB limit regardless of what is set.
    'max_attachment_mb',       25
  );
$$;

CREATE OR REPLACE FUNCTION public.default_org_settings()
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'attendance_policy', jsonb_build_object(
      'allow_remote',        true,
      'require_note_remote', false,
      'half_day_minutes',    240,
      'auto_absent',         true,
      'overtime_after_minutes', 540
    ),
    'leave_policy', jsonb_build_object(
      'types',              jsonb_build_array('vacation','sick','personal','maternity','paternity','bereavement','unpaid'),
      'requires_approval',  true,
      'min_notice_days',    0,
      'max_consecutive_days', 30,
      'allow_half_day',     true,
      'carry_over_days',    5
    ),
    'project_defaults', jsonb_build_object(
      'statuses',   jsonb_build_array('planning','active','on_hold','completed','cancelled','archived'),
      'priorities', jsonb_build_array('low','medium','high','critical'),
      'task_categories', jsonb_build_array('Feature','Bug','Improvement','Research','Documentation'),
      'milestone_stages', jsonb_build_array('planning','development','testing','review','deployment','completed'),
      'default_status',   'planning',
      'default_priority', 'medium',
      'templates', jsonb_build_array()
    ),
    'notification_events', jsonb_build_object(
      'project',      true,
      'task',         true,
      'milestone',    true,
      'leave',        true,
      'invoice',      true,
      'expense',      true,
      'ticket',       true,
      'comment',      true,
      'mention',      true,
      'message',      true,
      'announcement', true,
      'channel',      true,
      -- New in 0023. `notification_enabled()` defaults an unconfigured type to
      -- true, so meeting invitations already reached people before this key
      -- existed — what it adds is the ability to turn them *off*, which is the
      -- half that was missing.
      'meeting',      true
    ),
    'communication_policy', public.default_communication_policy()
  );
$$;

-- Every organisation that predates this migration gets the key.
INSERT INTO org_settings (organization_id, key, value)
SELECT o.id, 'communication_policy', public.default_communication_policy()
FROM organizations o
ON CONFLICT (organization_id, key) DO NOTHING;

-- And the new notification toggle, merged into whatever they already have so
-- an organisation that has turned things off keeps its choices.
UPDATE org_settings
   SET value = jsonb_build_object('meeting', true) || value
 WHERE key = 'notification_events'
   AND NOT (value ? 'meeting');

/**
 * Apply the retention policy, now.
 *
 * ── Why this is a button and not a cron job ──────────────────────────────
 *
 * Deleting a company's conversation history is not something that should
 * happen quietly at 3am because a number was typed into a settings box. An
 * administrator runs it, sees how many messages went, and the act is written
 * into the audit trail. Soft delete, like every other message deletion here,
 * so a thread's structure survives.
 */
CREATE OR REPLACE FUNCTION public.apply_message_retention(org uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  days    int;
  removed int := 0;
BEGIN
  IF NOT public.is_org_admin(org) THEN
    RAISE EXCEPTION 'Only an administrator can apply a retention policy.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE((value ->> 'retention_days')::int, 0)
    INTO days
    FROM org_settings
   WHERE organization_id = org AND key = 'communication_policy';

  IF days IS NULL OR days <= 0 THEN
    RETURN 0;
  END IF;

  WITH gone AS (
    UPDATE messages
       SET deleted_at = now(), body = ''
     WHERE organization_id = org
       AND deleted_at IS NULL
       AND created_at < now() - make_interval(days => days)
    RETURNING id
  )
  SELECT COUNT(*)::int INTO removed FROM gone;

  PERFORM public.log_communication_event(
    org, 'retention_applied', NULL, NULL, NULL,
    removed || ' messages older than ' || days || ' days'
  );

  RETURN removed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_message_retention(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  8. The sidebar, with its business context
-- ───────────────────────────────────────────────────────────────────────────
--
--  `channel_overview()` gains the columns the header needs to link a
--  conversation back to the work it is about, the caller's own mute flag —
--  `channel_members.is_muted` has existed since 0003, is accepted by the
--  members endpoint and has never been read by anything — the number of
--  pinned messages, and whether a meeting is running in this channel right
--  now, which is the single most useful thing a sidebar row can say.
--
--  A dropped and recreated function rather than CREATE OR REPLACE: Postgres
--  will not replace a function whose return type has changed.

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
  my_role         text,
  last_message    text,
  last_message_at timestamptz,
  last_sender     text,
  counterpart_id   uuid,
  counterpart_name text,
  counterpart_avatar text,
  -- Business context.
  project_id      uuid,
  project_name    text,
  company_id      uuid,
  company_name    text,
  department_id   uuid,
  department_name text,
  live_meeting_id uuid,
  -- Whether the caller was named in something they have not read. A mention
  -- has to be findable without opening forty channels to look for it.
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
        -- Matches `channels_select` exactly, including its exclusion of other
        -- people's direct messages from an administrator's list.
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
    (SELECT COUNT(*)::int FROM messages m
      WHERE m.channel_id = v.id
        AND m.deleted_at IS NULL
        AND m.sender_id IS DISTINCT FROM me.id
        AND m.created_at > COALESCE(
              (SELECT cm.last_read_at FROM channel_members cm
                WHERE cm.channel_id = v.id AND cm.member_id = me.id),
              '-infinity'::timestamptz)),
    (SELECT COUNT(*)::int FROM messages m
      WHERE m.channel_id = v.id AND m.deleted_at IS NULL AND m.is_pinned = true),
    EXISTS (SELECT 1 FROM channel_members cm
            WHERE cm.channel_id = v.id AND cm.member_id = me.id),
    public.is_channel_admin(v.id),
    COALESCE((SELECT cm.is_muted FROM channel_members cm
              WHERE cm.channel_id = v.id AND cm.member_id = me.id), false),
    (SELECT cm.role FROM channel_members cm
      WHERE cm.channel_id = v.id AND cm.member_id = me.id),
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
    (SELECT COUNT(*)::int FROM messages m
      WHERE m.channel_id = v.id
        AND m.deleted_at IS NULL
        AND me.id = ANY (m.mentions)
        AND m.created_at > COALESCE(
              (SELECT cm.last_read_at FROM channel_members cm
                WHERE cm.channel_id = v.id AND cm.member_id = me.id),
              '-infinity'::timestamptz))
  FROM visible v
  CROSS JOIN me
  LEFT JOIN projects    pr ON pr.id = v.project_id
  LEFT JOIN companies   co ON co.id = v.company_id
  LEFT JOIN departments dp ON dp.id = v.department_id
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
--  9. What `messages.attachments` now holds
-- ───────────────────────────────────────────────────────────────────────────
--
--  An array of references to business records, not files. Each entry:
--
--      { "kind": "task" | "page" | "project" | "invoice" | "ticket"
--                | "company" | "deal" | "meeting",
--        "id":    "<uuid>",
--        "label": "<what it was called when it was linked>" }
--
--  `label` is a snapshot on purpose. A reference has to render as something
--  readable without a join per message, and a link to a task that has since
--  been renamed should still say what was meant at the time — the id is what
--  opens the current record.
--
--  The constraint is deliberately shallow: it rejects a scalar or an object
--  where an array belongs, and says nothing about the entries. A CHECK that
--  enumerated the kinds would have to be dropped and rewritten every time a
--  module is added, which is how a constraint ends up being removed rather
--  than updated.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_attachments_array') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_attachments_array
      CHECK (jsonb_typeof(attachments) = 'array');
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  10. Realtime
-- ───────────────────────────────────────────────────────────────────────────
--
--  A meeting that only updates when you reload is not a meeting. Both tables
--  need REPLICA IDENTITY FULL as well as publication membership: the interesting
--  events here are UPDATEs on non-key columns — a hand going up, a participant
--  being admitted — and a filtered subscription to those matches nothing
--  without the full old row. That failure is silent, which is why
--  `db:verify` asserts it.

ALTER TABLE meetings             REPLICA IDENTITY FULL;
ALTER TABLE meeting_participants REPLICA IDENTITY FULL;
ALTER TABLE files                REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meetings', 'meeting_participants'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  11. Notifications a meeting produces
-- ───────────────────────────────────────────────────────────────────────────
--
--  Being invited to a meeting is the clearest case there is for a
--  notification: it is addressed to you, it has a time attached, and missing
--  it has a cost. Routed through `notify_members()` like everything else, so
--  the organisation's notification settings still govern it and the actor is
--  never notified of their own act.

CREATE OR REPLACE FUNCTION public.notify_meeting_invite()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m record;
BEGIN
  IF NEW.state <> 'invited' THEN
    RETURN NEW;
  END IF;

  SELECT id, organization_id, title, scheduled_at, status
    INTO m FROM meetings WHERE id = NEW.meeting_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  PERFORM public.notify_members(
    m.organization_id,
    ARRAY[NEW.member_id],
    'meeting',
    CASE WHEN m.status = 'live'
      THEN m.title || ' is starting now'
      ELSE 'You were invited to ' || m.title
    END,
    COALESCE(to_char(m.scheduled_at AT TIME ZONE 'UTC', 'DD Mon YYYY, HH24:MI') || ' UTC', ''),
    'meeting',
    m.id,
    '/dashboard?module=communication'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_participants_notify ON meeting_participants;
CREATE TRIGGER meeting_participants_notify
  AFTER INSERT ON meeting_participants
  FOR EACH ROW EXECUTE FUNCTION public.notify_meeting_invite();
