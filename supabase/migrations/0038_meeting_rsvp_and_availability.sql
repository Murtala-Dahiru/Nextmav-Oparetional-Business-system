-- ===========================================================================
--  0038 - An invitation you can answer, and a colleague you can see is busy
-- ===========================================================================
--
--  -- 1. There was no way to say yes --------------------------------------
--
--  `meeting_participants.state` has had `declined` since 0023 and no opposite.
--  So an invitation could be refused and not accepted: everybody who intended
--  to come sat in `invited` for ever, which is the same value as somebody who
--  had not looked at it. A host counting who is coming to a meeting they are
--  about to run could not tell the difference between an acceptance and
--  silence.
--
--  Two states are added: `accepted` and `tentative`. Not more. "Maybe" is a
--  real answer people give; anything past that is a form.
--
--  -- 2. `event_attendees` has never been written -------------------------
--
--  The table has existed since 0003, with a `response` column carrying exactly
--  the vocabulary above (`pending`, `accepted`, `declined`, `tentative`), and
--  nothing in the product has ever inserted a row. `sync_meeting_event()`
--  (0023) puts a scheduled meeting on the calendar and stops there, so the
--  event is org-visible and carries no attendees at all.
--
--  The consequence is the one that matters for this migration: **the calendar
--  cannot answer whether anybody is busy**, because nothing on it says who is
--  going to anything. Section 2 mirrors the meeting's participants onto its
--  calendar event, which makes `event_attendees` the one place "who is
--  attending what, and when" can be asked.
--
--  The mirror is one-directional on purpose. `meeting_participants` is the
--  meeting's truth - it carries the waiting room, the hand, the microphone -
--  and the calendar row is a projection of it. Two writable copies of an RSVP
--  is two answers to "is Ada coming".
--
--  -- 3. Free and busy ----------------------------------------------------
--
--  Section 3 answers "when is this person not free" for the people a caller is
--  about to invite. It returns **intervals and nothing else**: no title, no
--  location, no attendees. That is deliberate and it is the whole reason the
--  function can be SECURITY DEFINER - a colleague's calendar detail is theirs,
--  and "busy from 14:00 to 14:45" is the least that answers the question.
--
--  It is scoped to one organisation and to members of it, so it cannot be used
--  to enumerate anything across a tenant boundary.

-- ---------------------------------------------------------------------------
--  1. Answering an invitation
-- ---------------------------------------------------------------------------

ALTER TABLE meeting_participants
  DROP CONSTRAINT IF EXISTS meeting_participants_state_check;

ALTER TABLE meeting_participants
  ADD CONSTRAINT meeting_participants_state_check
  CHECK (state IN (
    'invited',    -- on the list, has not answered
    'accepted',   -- coming
    'tentative',  -- might come
    'declined',   -- not coming
    'knocking',   -- at the door, waiting room is on
    'admitted',   -- let in, not yet connected
    'joined',     -- in the room
    'left',       -- was here, has gone
    'removed'     -- put out by the host; may not knock again
  ));

COMMENT ON COLUMN meeting_participants.state IS
  'Where this person stands: their answer to the invitation before the '
  'meeting, and where they are in the room during it. One column because it '
  'is one question - a person who has joined has self-evidently accepted, and '
  'a second column would let the two disagree.';

-- ---------------------------------------------------------------------------
--  2. The calendar learns who is coming
-- ---------------------------------------------------------------------------

/**
 * Mirror a meeting's participants onto its calendar event.
 *
 * -- Why a projection rather than a second source -------------------------
 *
 * A meeting's guest list lives on `meeting_participants`, which also carries
 * the waiting room, the raised hand and the microphone. The calendar needs
 * only two of its facts - who, and what did they answer - and needs them in
 * the shape the calendar module already reads. So this writes them across, and
 * nothing writes back: `event_attendees` is derived, and the RSVP control in
 * the interface updates the meeting.
 *
 * `response` maps conservatively. Anything that is not an explicit answer is
 * `pending`, including `joined` - because turning up is not the same as having
 * said you would, and a calendar that reports a decision nobody made is worse
 * than one that reports none.
 */
CREATE OR REPLACE FUNCTION public.sync_meeting_attendee()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ev uuid;
BEGIN
  SELECT event_id INTO ev FROM meetings WHERE id = COALESCE(NEW.meeting_id, OLD.meeting_id);

  -- An ad-hoc call has no calendar event, and nothing to mirror onto.
  IF ev IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM event_attendees WHERE event_id = ev AND member_id = OLD.member_id;
    RETURN OLD;
  END IF;

  INSERT INTO event_attendees (event_id, member_id, response)
  VALUES (
    ev,
    NEW.member_id,
    CASE NEW.state
      WHEN 'accepted'  THEN 'accepted'
      WHEN 'declined'  THEN 'declined'
      WHEN 'tentative' THEN 'tentative'
      ELSE 'pending'
    END
  )
  ON CONFLICT (event_id, member_id) DO UPDATE
    SET response = EXCLUDED.response;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_participants_sync_attendee ON meeting_participants;
CREATE TRIGGER meeting_participants_sync_attendee
  AFTER INSERT OR UPDATE OF state OR DELETE ON meeting_participants
  FOR EACH ROW EXECUTE FUNCTION public.sync_meeting_attendee();

/**
 * The same, for participants who were added before their meeting had an event.
 *
 * `sync_meeting_event()` runs on the meeting and gives it `event_id`; the
 * participants may already exist by then, and their trigger has already fired
 * against a null event. So the meeting's own trigger backfills them once the
 * event exists.
 *
 * Appended to the existing function rather than replacing what it does: the
 * body below section 6 of 0023 is repeated verbatim apart from the two backfill
 * statements at the end.
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
    ev := NEW.event_id;
    UPDATE calendar_events
       SET title       = NEW.title,
           description = NEW.agenda,
           starts_at   = NEW.scheduled_at,
           ends_at     = NEW.scheduled_at + make_interval(mins => NEW.duration_minutes),
           project_id  = NEW.project_id,
           updated_at  = now()
     WHERE id = NEW.event_id;
  END IF;

  -- Everyone already on the guest list, now that there is an event to put
  -- them on. New in 0038.
  INSERT INTO event_attendees (event_id, member_id, response)
  SELECT ev, mp.member_id,
    CASE mp.state
      WHEN 'accepted'  THEN 'accepted'
      WHEN 'declined'  THEN 'declined'
      WHEN 'tentative' THEN 'tentative'
      ELSE 'pending'
    END
  FROM meeting_participants mp
  WHERE mp.meeting_id = NEW.id
  ON CONFLICT (event_id, member_id) DO UPDATE
    SET response = EXCLUDED.response;

  RETURN NEW;
END;
$$;

-- Backfill: every scheduled meeting that already exists has an event with no
-- attendees on it, because nothing has ever written one.
INSERT INTO event_attendees (event_id, member_id, response)
SELECT m.event_id, mp.member_id,
  CASE mp.state
    WHEN 'accepted'  THEN 'accepted'
    WHEN 'declined'  THEN 'declined'
    WHEN 'tentative' THEN 'tentative'
    ELSE 'pending'
  END
FROM meetings m
JOIN meeting_participants mp ON mp.meeting_id = m.id
WHERE m.event_id IS NOT NULL
ON CONFLICT (event_id, member_id) DO NOTHING;

-- The question this table is now asked: "what is on this person's calendar
-- between two times".
CREATE INDEX IF NOT EXISTS idx_event_attendees_member
  ON event_attendees (member_id);

-- ---------------------------------------------------------------------------
--  3. Free and busy
-- ---------------------------------------------------------------------------

/**
 * When are these people not free?
 *
 * -- What it returns, and what it deliberately does not -------------------
 *
 * Intervals. A member id, a start and an end, and whether the person had
 * accepted or merely been invited. **No title, no location, no description,
 * no other attendees.** That is what makes this safe to answer with SECURITY
 * DEFINER: free/busy is the minimum disclosure that answers "can we meet at
 * three", and it is a disclosure people expect a workplace calendar to make.
 * Anything richer is the calendar module's business and is governed by its own
 * policies.
 *
 * -- Why definer at all --------------------------------------------------
 *
 * Because an invoker function would return nothing for a colleague's private
 * event, and a scheduler that reports somebody as free when they are not is
 * worse than one with no availability at all: it produces a meeting in a slot
 * that was never open, confidently.
 *
 * -- The two guards ------------------------------------------------------
 *
 * The caller must be a member of `org`, and every id asked about must be a
 * member of the same organisation. Ids outside it are silently absent rather
 * than refused, so this cannot be used to test whether a given uuid exists
 * somewhere else in the platform.
 *
 * `declined` is not busy. Somebody who said no to a meeting is free at that
 * time, which is the entire point of having said no.
 */
CREATE OR REPLACE FUNCTION public.member_availability(
  org uuid,
  member_ids uuid[],
  from_at timestamptz,
  to_at timestamptz
)
RETURNS TABLE (
  member_id  uuid,
  busy_from  timestamptz,
  busy_to    timestamptz,
  confirmed  boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    ea.member_id,
    e.starts_at,
    e.ends_at,
    ea.response = 'accepted'
  FROM event_attendees ea
  JOIN calendar_events e ON e.id = ea.event_id
  JOIN organization_members om ON om.id = ea.member_id
  WHERE e.organization_id = org
    AND om.organization_id = org
    AND ea.member_id = ANY (member_ids)
    AND ea.response <> 'declined'
    AND e.starts_at < to_at
    AND e.ends_at   > from_at
    -- The caller has to be in this organisation. Without this the function
    -- would answer for any org id somebody cared to pass.
    AND public.auth_member_id(org) IS NOT NULL

  UNION ALL

  /**
   * The organiser's own events.
   *
   * Somebody who put an hour in their calendar and invited nobody is busy for
   * that hour, and there is no attendee row to say so - `event_attendees` is
   * written for guests. Without this the person most likely to be booked, the
   * one who books things, always reads as free.
   */
  SELECT
    e.created_by,
    e.starts_at,
    e.ends_at,
    true
  FROM calendar_events e
  JOIN organization_members om ON om.id = e.created_by
  WHERE e.organization_id = org
    AND om.organization_id = org
    AND e.created_by = ANY (member_ids)
    AND e.starts_at < to_at
    AND e.ends_at   > from_at
    AND public.auth_member_id(org) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM event_attendees ea2
      WHERE ea2.event_id = e.id AND ea2.member_id = e.created_by
    );
$$;

GRANT EXECUTE ON FUNCTION public.member_availability(uuid, uuid[], timestamptz, timestamptz)
  TO authenticated;
