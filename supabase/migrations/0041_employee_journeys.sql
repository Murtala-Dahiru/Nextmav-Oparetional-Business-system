-- ═══════════════════════════════════════════════════════════════════════════
--  0041 - Onboarding, offboarding, and the work they create
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Hiring somebody is not an event, it is a fortnight of small obligations
--  held by four different people: HR wants a signed contract, IT wants to
--  raise a laptop, the manager wants to book a first one-to-one, and the new
--  starter wants to know what they are supposed to do on Monday. Every HR
--  product models this as a checklist, and most of them stop there - a list
--  of ticks inside HR that nobody opens because it is not where they work.
--
--  -- The one decision that makes this different --------------------------
--
--  **An onboarding step is a to-do in My Work.**
--
--  Not a copy of one, and not a notification pointing at one: the row in
--  `employee_checklist_items` and the row in `todos` are created together and
--  tick each other off, in both directions, by trigger. The IT manager sees
--  "Issue laptop - Ada Balogun" in the list they already open every morning,
--  ticks it there, and HR's onboarding board moves.
--
--  `todos` has carried a generic source triple since 0026 - `source_module`,
--  `source_type`, `source_id`, `source_label` - built for exactly this and used
--  so far only by Projects. Adding a column here would have been a second
--  mechanism beside a working one, which is this repository's most expensive
--  recurring mistake.
--
--  -- Templates, and what they are not ------------------------------------
--
--  A template is configuration a company writes once. This file ships **no**
--  template rows: an invented "Welcome to the team!" step in every tenant's
--  database is fabricated data wearing a helpful hat. The API offers a starter
--  set on request, which is a different thing - somebody chose it.
--
--  -- Where offboarding stops ---------------------------------------------
--
--  `employee_exits` records the exit: type, last day, reason, whether we would
--  have them back. It does **not** close the account. Suspension, termination
--  and session revocation are the identity lifecycle's (0012, 0025), which is
--  the authoritative mechanism, and an HR checklist that could terminate
--  somebody as a side effect of ticking a box would be a second door into the
--  most consequential action in the product. Finishing the checklist stages
--  the account action and tells an administrator; a person still performs it.
--
--  Idempotent and additive.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
--  1. Vocabulary
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journey_kind') THEN
    CREATE TYPE journey_kind AS ENUM ('onboarding', 'offboarding');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journey_status') THEN
    CREATE TYPE journey_status AS ENUM ('active', 'completed', 'cancelled');
  END IF;

  /**
   * Who a step belongs to, expressed as a role in the process rather than a
   * person - because a template is written months before the person exists.
   * Resolved to an actual member when the checklist is created: `hr` to the
   * person running it, `manager` to the new starter's manager, `employee` to
   * the starter themselves.
   */
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_owner') THEN
    CREATE TYPE checklist_owner AS ENUM ('hr', 'manager', 'employee', 'it', 'finance');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_category') THEN
    CREATE TYPE checklist_category AS ENUM (
      'paperwork', 'equipment', 'access', 'training',
      'introductions', 'payroll', 'handover', 'return', 'other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exit_type') THEN
    CREATE TYPE exit_type AS ENUM (
      'resignation', 'dismissal', 'redundancy', 'retirement',
      'end_of_contract', 'mutual', 'other'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
--  2. Templates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS checklist_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind            journey_kind NOT NULL,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  description     text NOT NULL DEFAULT '',
  /* Optional narrowing: an engineering onboarding that is not a sales one. */
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  employment_type employment_type,
  is_default      boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind, name)
);

COMMENT ON TABLE public.checklist_templates IS
  'What this company does when somebody joins or leaves. Written by HR; this migration ships none.';

CREATE INDEX IF NOT EXISTS idx_checklist_templates_org
  ON checklist_templates (organization_id, kind) WHERE is_active;

DROP TRIGGER IF EXISTS trg_checklist_templates_updated ON checklist_templates;
CREATE TRIGGER trg_checklist_templates_updated BEFORE UPDATE ON checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS checklist_template_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id     uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,

  title           text NOT NULL CHECK (btrim(title) <> ''),
  description     text NOT NULL DEFAULT '',
  category        checklist_category NOT NULL DEFAULT 'other',
  owner           checklist_owner NOT NULL DEFAULT 'hr',

  /**
   * Days from the anchor date, signed.
   *
   * Negative is the useful half: a contract signed and a laptop ordered are
   * both *before* the first day, and a template that can only express "day
   * three" cannot describe the week that actually matters.
   */
  due_offset_days int NOT NULL DEFAULT 0,

  /* Whether ticking it should require a file - a signed contract, an ID. */
  requires_document boolean NOT NULL DEFAULT false,

  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_template_items
  ON checklist_template_items (template_id, sort_order);

-- ---------------------------------------------------------------------------
--  3. A person's own journey
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_checklists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,

  kind            journey_kind NOT NULL,
  name            text NOT NULL DEFAULT '',
  /**
   * The date everything is relative to: the first day for onboarding, the last
   * day for offboarding. Copied rather than joined, because `hired_on` can be
   * corrected and the due dates already handed out must not silently move.
   */
  anchor_date     date NOT NULL DEFAULT current_date,

  template_id     uuid REFERENCES checklist_templates(id) ON DELETE SET NULL,
  status          journey_status NOT NULL DEFAULT 'active',
  completed_at    timestamptz,

  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employee_checklists IS
  'One person joining or leaving, with the steps that involves. Its items are also to-dos in My Work.';

CREATE INDEX IF NOT EXISTS idx_employee_checklists_member
  ON employee_checklists (organization_id, member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_checklists_open
  ON employee_checklists (organization_id, kind) WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_employee_checklists_updated ON employee_checklists;
CREATE TRIGGER trg_employee_checklists_updated BEFORE UPDATE ON employee_checklists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS employee_checklist_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  checklist_id    uuid NOT NULL REFERENCES employee_checklists(id) ON DELETE CASCADE,
  /**
   * The person the checklist is about, denormalised.
   *
   * Every policy on this table asks "may you see this employee's records", and
   * a policy that has to join to answer its own question is a policy that will
   * one day be written without the join.
   */
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,

  title           text NOT NULL CHECK (btrim(title) <> ''),
  description     text NOT NULL DEFAULT '',
  category        checklist_category NOT NULL DEFAULT 'other',

  /** Who has to do it. Resolved from the template's `owner` at creation. */
  assignee_id     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  due_on          date,

  is_done         boolean NOT NULL DEFAULT false,
  completed_at    timestamptz,
  completed_by    uuid REFERENCES organization_members(id) ON DELETE SET NULL,

  requires_document boolean NOT NULL DEFAULT false,
  document_file_id  uuid REFERENCES files(id) ON DELETE SET NULL,

  /**
   * The personal to-do this step is. `SET NULL` rather than cascade: somebody
   * deleting a to-do off their own list must not delete the company's record
   * that the step exists.
   */
  todo_id         uuid REFERENCES todos(id) ON DELETE SET NULL,

  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist
  ON employee_checklist_items (checklist_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_checklist_items_assignee
  ON employee_checklist_items (assignee_id, due_on) WHERE is_done = false;
CREATE INDEX IF NOT EXISTS idx_checklist_items_todo
  ON employee_checklist_items (todo_id) WHERE todo_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_checklist_items_updated ON employee_checklist_items;
CREATE TRIGGER trg_checklist_items_updated BEFORE UPDATE ON employee_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
--  4. The step and the to-do are the same obligation
-- ---------------------------------------------------------------------------

/**
 * Give the step to its assignee, in the list they actually read.
 *
 * SECURITY DEFINER because `todos` admits only its owner, by design - HR
 * creating a to-do on the IT manager's list is the one legitimate exception,
 * and it is legitimate precisely because the to-do is not private content but
 * a company obligation the person already holds.
 *
 * `source_module`/`source_type`/`source_id` is 0026's triple. The unique index
 * it carries - one open personal item per source, per person - is why this
 * uses ON CONFLICT DO NOTHING rather than assuming.
 */
CREATE OR REPLACE FUNCTION public.mirror_checklist_item_to_todo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  subject text;
  label   text;
  new_todo uuid;
BEGIN
  IF NEW.assignee_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name INTO subject
    FROM organization_members om
    JOIN profiles p ON p.id = om.user_id
   WHERE om.id = NEW.member_id;

  SELECT CASE c.kind WHEN 'onboarding' THEN 'Onboarding' ELSE 'Offboarding' END
         || ' - ' || COALESCE(subject, 'an employee')
    INTO label
    FROM employee_checklists c WHERE c.id = NEW.checklist_id;

  IF TG_OP = 'INSERT' OR NEW.todo_id IS NULL THEN
    INSERT INTO todos (
      organization_id, member_id, title, note, due_on,
      source_module, source_type, source_id, source_label
    )
    VALUES (
      NEW.organization_id, NEW.assignee_id, NEW.title, NEW.description, NEW.due_on,
      'hr',
      (SELECT CASE c.kind WHEN 'onboarding' THEN 'onboarding_task' ELSE 'offboarding_task' END
         FROM employee_checklists c WHERE c.id = NEW.checklist_id),
      NEW.id, label
    )
    RETURNING id INTO new_todo;

    NEW.todo_id := new_todo;

  ELSIF TG_OP = 'UPDATE' THEN
    /* The assignee changed: the obligation moves, it is not duplicated. */
    IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
      UPDATE todos SET member_id = NEW.assignee_id WHERE id = NEW.todo_id;
    END IF;
    UPDATE todos
       SET title = NEW.title, note = NEW.description, due_on = NEW.due_on
     WHERE id = NEW.todo_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_checklist_item_to_todo ON employee_checklist_items;
CREATE TRIGGER trg_mirror_checklist_item_to_todo
  BEFORE INSERT OR UPDATE OF title, description, due_on, assignee_id
  ON employee_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.mirror_checklist_item_to_todo();

/**
 * Ticking the step ticks the to-do, and ticking the to-do ticks the step.
 *
 * Two triggers pointing at each other, which is a loop unless one of them
 * refuses to fire when there is nothing to change - so each guards on
 * `IS DISTINCT FROM` against the value it is about to write. The second write
 * finds the row already in the target state and updates nothing, so the
 * cascade stops after one hop.
 */
CREATE OR REPLACE FUNCTION public.sync_checklist_item_to_todo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.todo_id IS NOT NULL AND NEW.is_done IS DISTINCT FROM OLD.is_done THEN
    UPDATE todos SET is_done = NEW.is_done
     WHERE id = NEW.todo_id AND is_done IS DISTINCT FROM NEW.is_done;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_checklist_item_to_todo ON employee_checklist_items;
CREATE TRIGGER trg_sync_checklist_item_to_todo
  AFTER UPDATE OF is_done ON employee_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_checklist_item_to_todo();

CREATE OR REPLACE FUNCTION public.sync_todo_to_checklist_item()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source_module = 'hr'
     AND NEW.source_type IN ('onboarding_task', 'offboarding_task')
     AND NEW.is_done IS DISTINCT FROM OLD.is_done THEN
    UPDATE employee_checklist_items
       SET is_done      = NEW.is_done,
           completed_at = CASE WHEN NEW.is_done THEN now() ELSE NULL END,
           completed_by = CASE WHEN NEW.is_done THEN NEW.member_id ELSE NULL END
     WHERE id = NEW.source_id AND is_done IS DISTINCT FROM NEW.is_done;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_todo_to_checklist_item ON todos;
CREATE TRIGGER trg_sync_todo_to_checklist_item
  AFTER UPDATE OF is_done ON todos
  FOR EACH ROW EXECUTE FUNCTION public.sync_todo_to_checklist_item();

/** Ticking a step from the HR side stamps who and when. */
CREATE OR REPLACE FUNCTION public.stamp_checklist_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_done AND NOT OLD.is_done THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.completed_by := COALESCE(NEW.completed_by, public.auth_member_id(NEW.organization_id));
  ELSIF NOT NEW.is_done THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_checklist_item ON employee_checklist_items;
CREATE TRIGGER trg_stamp_checklist_item
  BEFORE UPDATE OF is_done ON employee_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.stamp_checklist_item();

/**
 * A finished onboarding makes somebody an employee.
 *
 * The one piece of genuine automation in this file, and it is bounded: the
 * last step being ticked closes the checklist, and closing an *onboarding*
 * checklist moves the membership from `onboarding` to `active`. It changes no
 * permission, no account state and no access - `lifecycle_stage` is
 * descriptive by construction (0039). Offboarding deliberately does not do the
 * reverse; see this file's header.
 */
CREATE OR REPLACE FUNCTION public.close_finished_checklist()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  remaining int;
  c         employee_checklists%ROWTYPE;
BEGIN
  SELECT count(*) INTO remaining
    FROM employee_checklist_items
   WHERE checklist_id = NEW.checklist_id AND is_done = false;

  SELECT * INTO c FROM employee_checklists WHERE id = NEW.checklist_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF remaining = 0 AND c.status = 'active' THEN
    UPDATE employee_checklists
       SET status = 'completed', completed_at = now()
     WHERE id = c.id;

    IF c.kind = 'onboarding' THEN
      UPDATE organization_members
         SET lifecycle_stage = 'active'
       WHERE id = c.member_id AND lifecycle_stage = 'onboarding';

      INSERT INTO notifications (
        organization_id, recipient_id, type, title, body, entity_type, entity_id, link
      )
      SELECT c.organization_id, c.created_by, 'onboarding_complete',
             'Onboarding complete',
             p.full_name || ' has finished onboarding.',
             'checklist', c.id,
             '/dashboard?module=hr&tab=journeys&checklist=' || c.id
        FROM organization_members om JOIN profiles p ON p.id = om.user_id
       WHERE om.id = c.member_id AND c.created_by IS NOT NULL;
    END IF;

  ELSIF remaining > 0 AND c.status = 'completed' THEN
    /* A step reopened: the journey is not finished after all. */
    UPDATE employee_checklists
       SET status = 'active', completed_at = NULL
     WHERE id = c.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_finished_checklist ON employee_checklist_items;
CREATE TRIGGER trg_close_finished_checklist
  AFTER UPDATE OF is_done ON employee_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.close_finished_checklist();

-- ---------------------------------------------------------------------------
--  5. Starting a journey from a template
-- ---------------------------------------------------------------------------

/**
 * Build somebody's checklist out of a template, resolving roles to people and
 * offsets to dates.
 *
 * SECURITY DEFINER, checked against the caller first. Returns the checklist so
 * the endpoint can answer with it rather than re-reading.
 *
 * `p_hr` defaults to the caller: the person starting the onboarding is
 * ordinarily the person who will do HR's half of it, and a step owned by
 * nobody is a step nobody does.
 */
CREATE OR REPLACE FUNCTION public.start_employee_checklist(
  p_member    uuid,
  p_kind      journey_kind,
  p_template  uuid DEFAULT NULL,
  p_anchor    date DEFAULT NULL,
  p_name      text DEFAULT NULL
)
RETURNS employee_checklists
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m        organization_members%ROWTYPE;
  actor    uuid;
  tpl      checklist_templates%ROWTYPE;
  list     employee_checklists%ROWTYPE;
  it       checklist_template_items%ROWTYPE;
  anchor   date;
  owner_id uuid;
BEGIN
  SELECT * INTO m FROM organization_members WHERE id = p_member;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That employee does not exist.' USING ERRCODE = 'no_data_found';
  END IF;

  IF public.auth_role_in(m.organization_id) NOT IN ('owner', 'administrator', 'hr_staff') THEN
    RAISE EXCEPTION 'Only HR and administrators may start an onboarding or offboarding.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  actor := public.auth_member_id(m.organization_id);

  anchor := COALESCE(
    p_anchor,
    CASE WHEN p_kind = 'onboarding' THEN m.hired_on ELSE NULL END,
    current_date
  );

  IF p_template IS NOT NULL THEN
    SELECT * INTO tpl FROM checklist_templates
     WHERE id = p_template AND organization_id = m.organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That template belongs to another organisation.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF tpl.kind <> p_kind THEN
      RAISE EXCEPTION 'That template is for % , not %.', tpl.kind, p_kind
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO employee_checklists (
    organization_id, member_id, kind, name, anchor_date, template_id, created_by
  )
  VALUES (
    m.organization_id, p_member, p_kind,
    COALESCE(NULLIF(btrim(p_name), ''), tpl.name,
             CASE p_kind WHEN 'onboarding' THEN 'Onboarding' ELSE 'Offboarding' END),
    anchor, tpl.id, actor
  )
  RETURNING * INTO list;

  IF tpl.id IS NOT NULL THEN
    FOR it IN
      SELECT * FROM checklist_template_items
       WHERE template_id = tpl.id ORDER BY sort_order, created_at
    LOOP
      owner_id := CASE it.owner
        WHEN 'employee' THEN p_member
        WHEN 'manager'  THEN m.manager_id
        ELSE actor
      END;

      INSERT INTO employee_checklist_items (
        organization_id, checklist_id, member_id, title, description,
        category, assignee_id, due_on, requires_document, sort_order
      )
      VALUES (
        m.organization_id, list.id, p_member, it.title, it.description,
        it.category, owner_id, anchor + it.due_offset_days,
        it.requires_document, it.sort_order
      );
    END LOOP;
  END IF;

  RETURN list;
END;
$$;

REVOKE ALL ON FUNCTION public.start_employee_checklist(uuid, journey_kind, uuid, date, text) FROM public;
GRANT EXECUTE ON FUNCTION public.start_employee_checklist(uuid, journey_kind, uuid, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
--  6. The exit record
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_exits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,

  exit_type       exit_type NOT NULL DEFAULT 'resignation',
  /* When they told us, and when they stop. Both are asked for in every audit. */
  notified_on     date NOT NULL DEFAULT current_date,
  last_working_day date NOT NULL,

  reason          text NOT NULL DEFAULT '',
  /**
   * Would we have them back. A single boolean, deliberately, because the
   * long-form version of this question is an exit interview and belongs in the
   * notes rather than in a column somebody has to interpret.
   */
  is_rehirable    boolean,
  exit_interview  text NOT NULL DEFAULT '',

  checklist_id    uuid REFERENCES employee_checklists(id) ON DELETE SET NULL,

  /**
   * Whether an administrator has since closed the account.
   *
   * Recorded, not enforced: the identity lifecycle owns termination and this
   * column is HR's view of whether it has happened, so the offboarding screen
   * can say "access is still open" instead of implying it is not.
   */
  account_closed_at timestamptz,

  recorded_by     uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT exit_dates_valid CHECK (last_working_day >= notified_on),
  /* One exit per employment. A rehire is a new membership. */
  UNIQUE (member_id)
);

COMMENT ON TABLE public.employee_exits IS
  'Why and when somebody left. Does not close the account: that is the identity lifecycle, and it stays the only door.';

CREATE INDEX IF NOT EXISTS idx_employee_exits_org
  ON employee_exits (organization_id, last_working_day DESC);

DROP TRIGGER IF EXISTS trg_employee_exits_updated ON employee_exits;
CREATE TRIGGER trg_employee_exits_updated BEFORE UPDATE ON employee_exits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/**
 * Recording an exit moves the person to `notice_period`, and writes the event.
 *
 * The stage, not the status: they are still an employee until their last day,
 * and a system that hides somebody from the directory the moment they resign
 * makes the handover impossible.
 */
CREATE OR REPLACE FUNCTION public.stage_exit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organization_members
     SET lifecycle_stage = CASE
           WHEN NEW.last_working_day <= current_date THEN 'offboarding'
           ELSE 'notice_period'
         END
   WHERE id = NEW.member_id AND status <> 'terminated';

  INSERT INTO employment_events (
    organization_id, member_id, kind, effective_on,
    stage_before, stage_after, reason, note, details, recorded_by
  )
  SELECT
    NEW.organization_id, NEW.member_id, 'offboarded', NEW.last_working_day,
    om.lifecycle_stage, om.lifecycle_stage,
    NEW.exit_type::text, NEW.reason,
    jsonb_build_object('exitId', NEW.id, 'exitType', NEW.exit_type),
    NEW.recorded_by
  FROM organization_members om WHERE om.id = NEW.member_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stage_exit ON employee_exits;
CREATE TRIGGER trg_stage_exit
  AFTER INSERT ON employee_exits
  FOR EACH ROW EXECUTE FUNCTION public.stage_exit();

-- ---------------------------------------------------------------------------
--  7. Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates FORCE ROW LEVEL SECURITY;

/* A template is company process, not personal data: everybody may read what
   joining here involves. Writing it is HR's. */
DROP POLICY IF EXISTS checklist_templates_select ON checklist_templates;
CREATE POLICY checklist_templates_select ON checklist_templates FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_access_module(organization_id, 'hr')
  );

DROP POLICY IF EXISTS checklist_templates_write ON checklist_templates;
CREATE POLICY checklist_templates_write ON checklist_templates FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

ALTER TABLE checklist_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_template_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklist_template_items_select ON checklist_template_items;
CREATE POLICY checklist_template_items_select ON checklist_template_items FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.can_access_module(organization_id, 'hr')
  );

DROP POLICY IF EXISTS checklist_template_items_write ON checklist_template_items;
CREATE POLICY checklist_template_items_write ON checklist_template_items FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

ALTER TABLE employee_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_checklists FORCE ROW LEVEL SECURITY;

/**
 * You see your own journey, your people's if you manage them, everybody's if
 * you are HR - which is `auth_visible_member_ids()` and nothing new.
 */
DROP POLICY IF EXISTS employee_checklists_select ON employee_checklists;
CREATE POLICY employee_checklists_select ON employee_checklists FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND member_id = ANY (public.auth_visible_member_ids(organization_id))
  );

DROP POLICY IF EXISTS employee_checklists_write ON employee_checklists;
CREATE POLICY employee_checklists_write ON employee_checklists FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

ALTER TABLE employee_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_checklist_items FORCE ROW LEVEL SECURITY;

/**
 * Read: the subject, their management chain, HR - and the assignee, who may be
 * none of those. The IT manager issuing a laptop is not in the new starter's
 * reporting line and still has to see the step.
 */
DROP POLICY IF EXISTS employee_checklist_items_select ON employee_checklist_items;
CREATE POLICY employee_checklist_items_select ON employee_checklist_items FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      member_id = ANY (public.auth_visible_member_ids(organization_id))
      OR assignee_id = public.auth_member_id(organization_id)
    )
  );

/* Ticking your own step is the ordinary case, so update is wider than insert. */
DROP POLICY IF EXISTS employee_checklist_items_insert ON employee_checklist_items;
CREATE POLICY employee_checklist_items_insert ON employee_checklist_items FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

DROP POLICY IF EXISTS employee_checklist_items_update ON employee_checklist_items;
CREATE POLICY employee_checklist_items_update ON employee_checklist_items FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      assignee_id = public.auth_member_id(organization_id)
      OR public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
    )
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND (
      assignee_id = public.auth_member_id(organization_id)
      OR public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
    )
  );

DROP POLICY IF EXISTS employee_checklist_items_delete ON employee_checklist_items;
CREATE POLICY employee_checklist_items_delete ON employee_checklist_items FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

ALTER TABLE employee_exits ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_exits FORCE ROW LEVEL SECURITY;

/**
 * HR and administrators only, including the subject.
 *
 * Unlike a checklist, an exit record carries the company's account of why
 * somebody left and whether it would take them back. That is not a record its
 * subject should read in a self-service screen, and it is not a manager's
 * either.
 */
DROP POLICY IF EXISTS employee_exits_select ON employee_exits;
CREATE POLICY employee_exits_select ON employee_exits FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

DROP POLICY IF EXISTS employee_exits_write ON employee_exits;
CREATE POLICY employee_exits_write ON employee_exits FOR ALL TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  )
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) IN ('owner', 'administrator', 'hr_staff')
  );

-- ---------------------------------------------------------------------------
--  8. Realtime
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employee_checklists', 'employee_checklist_items', 'employee_exits'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
