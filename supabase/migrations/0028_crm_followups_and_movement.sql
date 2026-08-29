-- ═══════════════════════════════════════════════════════════════════════════
--  0028 - CRM: follow-ups, deal movement, and the notifications neither had
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Phase 4 of the redesign is CRM. The audit that preceded it found the same
--  shape this repository keeps producing: the schema was ready and nothing
--  called it.
--
--    · `crm_activities.due_at` and `.completed_at` have existed since 0003.
--      They are exactly a follow-up: a thing to do about a customer, on a
--      date, that can be ticked off. No endpoint filtered on them, no screen
--      showed them, and no clock ever looked at them.
--
--    · `deals.closed_at` and `.lost_reason` have existed just as long. The
--      create route never set them, the update schema did not name them, and
--      the only writer either column has ever had is the demo seeder. So a
--      deal moved to Closed Won by a salesperson carried no close date, which
--      is the one field a win rate over time is computed from.
--
--    · `crm_activities` was left out of the realtime publication in both 0006
--      and 0020, while its four sibling tables were added. A customer timeline
--      is precisely the thing two people watch at once.
--
--    · Not one notification in the product concerns a lead or a deal. Work is
--      assigned in CRM the same way it is in Projects and Support, and only
--      those two tell anybody.
--
--  This migration closes those four, and adds the one table the product does
--  not have and cannot infer: where a deal has been.
--
--  ── What is deliberately not here ────────────────────────────────────────
--
--  No import-batch tables. The Import Center writes leads, contacts and
--  companies through the tables that already exist, and records what it did
--  in `activity_log` - which is the platform's own answer to "what happened",
--  and already has a feed rendering it. A second history table for one
--  feature would be a source of truth nobody reads.
--
--  Idempotent: safe to re-run, like every migration in this chain.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. The customer timeline goes live
-- ───────────────────────────────────────────────────────────────────────────
--
--  `REPLICA IDENTITY FULL` for the reason 0018 and 0020 both give: without it
--  an UPDATE arrives carrying only the primary key, so a subscription filtered
--  on a non-key column receives inserts and silently misses every edit - and
--  the customer screen subscribes on exactly that.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'crm_activities') THEN
    ALTER TABLE public.crm_activities REPLICA IDENTITY FULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'crm_activities'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_activities;
    END IF;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  2. Follow-ups
-- ───────────────────────────────────────────────────────────────────────────
--
--  ── Why no new table ─────────────────────────────────────────────────────
--
--  A follow-up is an activity that has not happened yet. "Call Ahmed back on
--  Tuesday" and "Called Ahmed on Tuesday" are one row at two moments in its
--  life, and modelling them separately would mean every timeline was a UNION
--  and every completion was a copy from one table into another. `due_at` is
--  when it is owed; `completed_at` is when it was done; the polymorphic links
--  already say who it is about.
--
--  What was genuinely missing is the *reminder*: a due date is a date, and a
--  reminder is an instant. My Work drew that distinction in 0026, and it is
--  the same distinction that separates "follow up on the 5th" from "remind me
--  at 9am on the 5th". The columns are named identically to `todos` on
--  purpose - one vocabulary, two consumers.

ALTER TABLE crm_activities
  ADD COLUMN IF NOT EXISTS remind_at        timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

COMMENT ON COLUMN public.crm_activities.due_at IS
  'When this follow-up is owed. An activity with a due_at and no completed_at is an open follow-up; one with a completed_at is history. NULL means the row records something that already happened.';

COMMENT ON COLUMN public.crm_activities.remind_at IS
  'When to raise this follow-up with its owner. Distinct from due_at: that is the day it is owed, this is the instant somebody is told. NULL means no reminder, which is the default.';

COMMENT ON COLUMN public.crm_activities.reminder_sent_at IS
  'When the reminder was delivered. Set by sweep_crm_reminders(), cleared by trigger whenever remind_at moves, so a rescheduled follow-up fires again.';

/**
 * The follow-up queue's index.
 *
 * Today / Overdue / Upcoming is one range scan over open follow-ups within a
 * tenant. Partial, because the rows that matter are a small minority of a
 * timeline that grows for ever.
 */
CREATE INDEX IF NOT EXISTS idx_crm_act_due
  ON crm_activities (organization_id, due_at)
  WHERE due_at IS NOT NULL AND completed_at IS NULL;

-- The sweep's own probe: the rows actually waiting on a clock.
CREATE INDEX IF NOT EXISTS idx_crm_act_remind
  ON crm_activities (remind_at)
  WHERE remind_at IS NOT NULL AND reminder_sent_at IS NULL AND completed_at IS NULL;

-- The customer timeline reads by company and by lead; 0003 indexed only deal
-- and contact, so a company with a long history was a sequential scan.
CREATE INDEX IF NOT EXISTS idx_crm_act_company
  ON crm_activities (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_act_lead
  ON crm_activities (lead_id, created_at DESC);

/**
 * Moving a reminder re-arms it.
 *
 * Same trigger as `rearm_todo_reminder`, same reason: without it, pushing a
 * follow-up you have already been reminded about sets a new time and is never
 * delivered, because the row still carries the stamp from the first one.
 * BEFORE, so the cleared stamp is part of the same row version.
 */
CREATE OR REPLACE FUNCTION public.rearm_crm_reminder()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.remind_at IS DISTINCT FROM OLD.remind_at THEN
    NEW.reminder_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rearm_crm_reminder ON crm_activities;
CREATE TRIGGER trg_rearm_crm_reminder
  BEFORE UPDATE ON crm_activities
  FOR EACH ROW EXECUTE FUNCTION public.rearm_crm_reminder();

/**
 * Deliver every follow-up reminder that has come due, exactly once.
 *
 * Modelled on `sweep_todo_reminders()` in 0026 and sharing its guarantees: the
 * claim and the read are one statement, so two concurrent sweeps cannot both
 * deliver the same reminder; anything more than two days stale is claimed and
 * dropped rather than delivered, because a reminder for last Tuesday arriving
 * now is noise; and the recipient is always the row's own `member_id`, so a
 * sweep triggered by one person cannot route another person's reminder
 * anywhere it was not already going.
 */
CREATE OR REPLACE FUNCTION public.sweep_crm_reminders(limit_rows int DEFAULT 500)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  delivered int;
BEGIN
  WITH claimed AS (
    UPDATE crm_activities
       SET reminder_sent_at = now()
     WHERE id IN (
       SELECT id FROM crm_activities
        WHERE remind_at IS NOT NULL
          AND reminder_sent_at IS NULL
          AND completed_at IS NULL
          AND member_id IS NOT NULL
          AND remind_at <= now()
        ORDER BY remind_at
        LIMIT GREATEST(1, LEAST(limit_rows, 2000))
     )
    RETURNING id, organization_id, member_id, subject, body, due_at, remind_at
  ), fresh AS (
    SELECT * FROM claimed WHERE remind_at > now() - interval '2 days'
  )
  INSERT INTO notifications (
    organization_id, recipient_id, type, title, body, entity_type, entity_id, link
  )
  SELECT
    organization_id,
    member_id,
    'crm_followup_due',
    COALESCE(NULLIF(btrim(subject), ''), 'Follow-up due'),
    COALESCE(
      NULLIF(btrim(body), ''),
      CASE
        WHEN due_at IS NULL THEN 'A follow-up you scheduled.'
        ELSE 'Due ' || to_char(due_at, 'FMDD FMMon') || '.'
      END
    ),
    'crm_activity',
    id,
    '/dashboard?module=crm'
  FROM fresh;

  GET DIAGNOSTICS delivered = ROW_COUNT;
  RETURN delivered;
END;
$$;

COMMENT ON FUNCTION public.sweep_crm_reminders(int) IS
  'Turn every CRM follow-up reminder that has come due into a notification, exactly once. Called every minute by pg_cron where it is available, and by /api/crm/followups/sweep from the application otherwise.';

/**
 * Executable by any signed-in member, for the reason 0026 sets out at length:
 * the function chooses no recipients, so what a caller can do is make the
 * clock tick. SECURITY DEFINER because RLS would otherwise hide every other
 * person's due reminder from the sweep, and the feature would work only for
 * whoever happened to have the app open.
 */
REVOKE ALL ON FUNCTION public.sweep_crm_reminders(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_crm_reminders(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_crm_reminders(int) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  3. Where a deal has been
-- ───────────────────────────────────────────────────────────────────────────
--
--  ── Why this cannot be inferred ──────────────────────────────────────────
--
--  Time in stage, average sales cycle, "moved forward this week", and a funnel
--  that means anything all require knowing when a deal entered a stage.
--  `deals` holds only where it is now. `audit_log` holds the change but is
--  deliberately append-only, unindexed for this question, and restricted -
--  reporting off the audit trail is how audit trails stop being trustworthy.
--
--  So: one narrow table, written by trigger, that nothing else can write. It
--  is the smallest thing that makes deal movement a fact rather than a guess.

CREATE TABLE IF NOT EXISTS deal_stage_events (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage      deal_stage,
  to_stage        deal_stage NOT NULL,
  -- Who moved it. NULL for a move made by a migration or a seeder, which is
  -- honest: nobody did it.
  member_id       uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  value_at        numeric(14,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.deal_stage_events IS
  'Every stage a deal has been in, and when it arrived. Written only by record_deal_stage_change(); no endpoint inserts here.';

CREATE INDEX IF NOT EXISTS idx_deal_stage_events_deal
  ON deal_stage_events (deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deal_stage_events_org
  ON deal_stage_events (organization_id, created_at DESC);

ALTER TABLE deal_stage_events ENABLE ROW LEVEL SECURITY;

/**
 * FORCE, for the reason 0005 gives for every other table: without it, any
 * connection authenticating as the owner - a pooler misconfiguration, a psql
 * session, an ORM on the wrong role - reads across all tenants, and RLS is
 * merely advisory. `db:verify` checks this on every table and would have
 * caught its absence; it did.
 */
ALTER TABLE deal_stage_events FORCE ROW LEVEL SECURITY;

/**
 * Readable by anyone who can read the deal. Never editable, by anyone.
 *
 * ── The three policies, and the two that are missing ─────────────────────
 *
 * SELECT is gated the way every other CRM table is. It reads the membership
 * helpers, not this table, so the self-reference trap that broke every
 * `INSERT ... RETURNING` elsewhere in this schema does not apply.
 *
 * INSERT exists only because the table is FORCE'd: the writer is a SECURITY
 * DEFINER trigger, and under FORCE even the owner is held to the policies, so
 * without this a salesperson moving a deal would get their write refused by
 * the history table behind it. The check is the tenant and nothing else -
 * there is no endpoint that posts here, and the trigger is the only caller.
 *
 * There is deliberately **no UPDATE and no DELETE policy**. A history somebody
 * can edit is not a history.
 */
DROP POLICY IF EXISTS deal_stage_events_select ON deal_stage_events;
CREATE POLICY deal_stage_events_select ON deal_stage_events FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_access_module(organization_id, 'crm')
  );

DROP POLICY IF EXISTS deal_stage_events_insert ON deal_stage_events;
CREATE POLICY deal_stage_events_insert ON deal_stage_events FOR INSERT TO authenticated
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

/**
 * Keep `closed_at` and `lost_reason` true, without asking anybody to.
 *
 * `closed_at` is not a field a salesperson should have to remember. It is a
 * fact implied by the stage, and the product's automation rule is "do it once,
 * let the system propagate it". Leaving it to the client is what produced the
 * current state: a column filled in by the seeder and by nothing else, which
 * every revenue-over-time figure then had to work around.
 *
 * Reopening a closed deal clears it, because a deal back in negotiation did
 * not close. And a deal that is not lost carries no lost reason - keeping one
 * is how a "why did we lose it" report ends up counting wins.
 *
 * BEFORE, so the stamp is part of the same row version rather than a second
 * UPDATE that would re-fire every trigger on the table.
 */
CREATE OR REPLACE FUNCTION public.stamp_deal_closure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  closing boolean := NEW.stage IN ('closed_won', 'closed_lost');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF closing AND NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
    IF NEW.stage <> 'closed_lost' THEN
      NEW.lost_reason := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF closing THEN
      -- A close date sent deliberately with the same request wins; this only
      -- fills the gap where the client said nothing.
      IF NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at THEN
        NEW.closed_at := now();
      END IF;
    ELSE
      NEW.closed_at := NULL;
    END IF;
  END IF;

  IF NEW.stage <> 'closed_lost' THEN
    NEW.lost_reason := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_deal_closure ON deals;
CREATE TRIGGER trg_stamp_deal_closure
  BEFORE INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.stamp_deal_closure();

CREATE OR REPLACE FUNCTION public.record_deal_stage_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO deal_stage_events (
      organization_id, deal_id, from_stage, to_stage, member_id, value_at
    )
    VALUES (
      NEW.organization_id, NEW.id, NULL, NEW.stage,
      public.auth_member_id(NEW.organization_id), COALESCE(NEW.value, 0)
    );
    RETURN NEW;
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO deal_stage_events (
      organization_id, deal_id, from_stage, to_stage, member_id, value_at
    )
    VALUES (
      NEW.organization_id, NEW.id, OLD.stage, NEW.stage,
      public.auth_member_id(NEW.organization_id), COALESCE(NEW.value, 0)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_deal_stage ON deals;
CREATE TRIGGER trg_record_deal_stage
  AFTER INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.record_deal_stage_change();

/**
 * Backfill, so the history does not start empty.
 *
 * One row per existing deal, at its current stage, dated from the deal's own
 * `closed_at` or `created_at`. It is not a reconstruction of moves nobody
 * recorded - it is the honest statement "this is where it was when we started
 * keeping track", which is what makes the first weeks of any time-in-stage
 * figure readable rather than absent.
 */
INSERT INTO deal_stage_events (organization_id, deal_id, from_stage, to_stage, member_id, value_at, created_at)
SELECT d.organization_id, d.id, NULL, d.stage, d.owner_id, COALESCE(d.value, 0),
       COALESCE(d.closed_at, d.created_at)
  FROM deals d
 WHERE d.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM deal_stage_events e WHERE e.deal_id = d.id);

/**
 * And close the deals the old API left open-ended.
 *
 * A deal sitting in Closed Won with no `closed_at` is invisible to every
 * revenue-by-period figure in the new CRM Home, which reads the close date
 * rather than the update timestamp. `updated_at` is the best evidence
 * available of when it happened.
 */
UPDATE deals
   SET closed_at = COALESCE(updated_at, created_at)
 WHERE stage IN ('closed_won', 'closed_lost')
   AND closed_at IS NULL
   AND deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  4. CRM tells people things
-- ───────────────────────────────────────────────────────────────────────────
--
--  Four events, chosen because each one is work landing on somebody or a fact
--  that changes what they should do next. Everything else a CRM could shout
--  about - a field edited, a note added, a lead viewed - is noise, and a bell
--  that cries wolf is a bell people turn off.
--
--  Every notification carries a `link`, because 0027 is the migration that
--  existed solely to add one that had been missing since 0004. A notification
--  that cannot be opened is a workflow with a hole in it.
--
--  None of them tells you about something you did yourself. That rule is
--  already in `notify_task_assignment()`; it is restated here rather than
--  shared, because the two functions have different subjects and a shared
--  helper would have to be told which column holds the actor anyway.

CREATE OR REPLACE FUNCTION public.notify_lead_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor uuid;
  who   text;
BEGIN
  IF NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
    RETURN NEW;
  END IF;

  actor := COALESCE(public.auth_member_id(NEW.organization_id),
                    '00000000-0000-0000-0000-000000000000'::uuid);
  IF NEW.owner_id = actor THEN RETURN NEW; END IF;

  who := btrim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
  IF who = '' THEN who := COALESCE(NULLIF(btrim(NEW.company_name), ''), 'Unnamed lead'); END IF;

  INSERT INTO notifications (
    organization_id, recipient_id, type, title, body, entity_type, entity_id, link
  )
  VALUES (
    NEW.organization_id, NEW.owner_id, 'lead_assigned',
    'New lead assigned',
    who || COALESCE(' · ' || NULLIF(btrim(NEW.company_name), ''), ''),
    'lead', NEW.id,
    '/dashboard?module=crm&lead=' || NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_lead_assignment ON leads;
CREATE TRIGGER trg_notify_lead_assignment
  AFTER INSERT OR UPDATE OF owner_id ON leads
  FOR EACH ROW EXECUTE FUNCTION public.notify_lead_assignment();

/**
 * A deal changing hands, and a deal closing.
 *
 * The close notification goes to the *owner*, and only when somebody else
 * closed it - which is the case that matters, because a deal you did not close
 * moving to won or lost is news. Both are written from one function because
 * they read the same row and would otherwise duplicate the actor lookup and
 * the link.
 */
CREATE OR REPLACE FUNCTION public.notify_deal_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor uuid;
  link  text;
BEGIN
  actor := COALESCE(public.auth_member_id(NEW.organization_id),
                    '00000000-0000-0000-0000-000000000000'::uuid);
  link := '/dashboard?module=crm&deal=' || NEW.id;

  IF NEW.owner_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.owner_id IS DISTINCT FROM OLD.owner_id)
     AND NEW.owner_id <> actor THEN
    INSERT INTO notifications (
      organization_id, recipient_id, type, title, body, entity_type, entity_id, link
    )
    VALUES (
      NEW.organization_id, NEW.owner_id, 'deal_assigned',
      'Deal assigned to you', NEW.name, 'deal', NEW.id, link
    );
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.stage IS DISTINCT FROM OLD.stage
     AND NEW.stage IN ('closed_won', 'closed_lost')
     AND NEW.owner_id IS NOT NULL
     AND NEW.owner_id <> actor THEN
    INSERT INTO notifications (
      organization_id, recipient_id, type, title, body, entity_type, entity_id, link
    )
    VALUES (
      NEW.organization_id, NEW.owner_id,
      CASE WHEN NEW.stage = 'closed_won' THEN 'deal_won' ELSE 'deal_lost' END,
      CASE WHEN NEW.stage = 'closed_won' THEN 'Deal won' ELSE 'Deal lost' END,
      NEW.name, 'deal', NEW.id, link
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_deal_change ON deals;
CREATE TRIGGER trg_notify_deal_change
  AFTER INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.notify_deal_change();

-- ───────────────────────────────────────────────────────────────────────────
--  5. Two rollups CRM Home cannot compute in the client
-- ───────────────────────────────────────────────────────────────────────────
--
--  PostgREST has no GROUP BY, so a screen that wants "pipeline by stage, by
--  owner" has two options: fetch every row and add them up in JavaScript, or
--  ask the database. The first is what the old CRM did - `?pageSize=100` and
--  a `reduce()` - and it is wrong twice over: the figures are silently capped
--  at a hundred records, and the hundred are chosen by `created_at`.
--
--  `v_pipeline_summary` has answered the first half since 0007 and the
--  dashboard reads it. It has no owner column, so "revenue by owner" and a
--  salesperson's own pipeline both had to be computed some other way. These
--  two views add that dimension and the equivalent for leads.
--
--  Deliberately no time bucketing in either. `closed_at` is a `timestamptz`
--  and a view cannot know the organisation's timezone, so a month boundary
--  drawn here would put a deal signed at half past eleven on the 31st into the
--  wrong month for every workspace east of UTC. Monthly series are built in
--  the route, where `ctx.org.timezone` is in hand - which is the same reason
--  `/api/dashboard` computes its own day bounds rather than trusting UTC.
--
--  `security_invoker`, like every other view in this schema: the caller's RLS
--  governs the rollup exactly as it governs the tables.

CREATE OR REPLACE VIEW public.v_crm_pipeline_owner
WITH (security_invoker = true) AS
SELECT
  d.organization_id,
  d.owner_id,
  d.stage,
  count(*)                                          AS deal_count,
  COALESCE(sum(d.value), 0)                         AS total_value,
  COALESCE(sum(d.value * d.probability / 100.0), 0) AS weighted_value
FROM deals d
WHERE d.deleted_at IS NULL
GROUP BY d.organization_id, d.owner_id, d.stage;

COMMENT ON VIEW public.v_crm_pipeline_owner IS
  'v_pipeline_summary with the owner kept, so CRM Home can show one salespersons pipeline as well as the companys without reading every deal row.';

CREATE OR REPLACE VIEW public.v_crm_lead_funnel
WITH (security_invoker = true) AS
SELECT
  l.organization_id,
  l.owner_id,
  l.status,
  count(*)                                  AS lead_count,
  COALESCE(sum(l.estimated_value), 0)       AS estimated_value,
  count(*) FILTER (WHERE l.converted_contact_id IS NOT NULL) AS converted_count
FROM leads l
WHERE l.deleted_at IS NULL
GROUP BY l.organization_id, l.owner_id, l.status;

COMMENT ON VIEW public.v_crm_lead_funnel IS
  'Leads by status and owner, with the estimated value behind each stage. The lead half of what v_crm_pipeline_owner does for deals.';

-- ───────────────────────────────────────────────────────────────────────────
--  6. The schedule
-- ───────────────────────────────────────────────────────────────────────────
--
--  Guarded exactly as 0026's is: `pg_cron` is available on Supabase and on
--  most managed Postgres, and absent on a plain local one, and a migration
--  that refuses to apply because an extension is missing is a migration nobody
--  can run on their laptop. Where it cannot be installed the sweep still
--  exists and the application still calls it.

DO $$
DECLARE
  have_cron boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
    INTO have_cron;

  IF NOT have_cron THEN
    RAISE NOTICE 'pg_cron is not available here; CRM follow-up reminders will be swept by the application instead.';
    RETURN;
  END IF;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron could not be installed (%); CRM follow-up reminders will be swept by the application instead.', SQLERRM;
    RETURN;
  END;

  BEGIN
    PERFORM cron.unschedule('sweep-crm-followups');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- no such job yet, which is the ordinary first run
  END;

  /**
   * Every minute, for the same reason the to-do sweep is: a coarser schedule
   * would make "remind me at 9:00" mean "some time in the next quarter of an
   * hour", and a reminder that is not on time is not a reminder. The sweep
   * reads a partial index over the rows actually waiting, so the common case -
   * nothing due - is one index probe.
   */
  PERFORM cron.schedule(
    'sweep-crm-followups',
    '* * * * *',
    $job$ SELECT public.sweep_crm_reminders(); $job$
  );

  RAISE NOTICE 'pg_cron: sweep-crm-followups scheduled every minute.';
END $$;
