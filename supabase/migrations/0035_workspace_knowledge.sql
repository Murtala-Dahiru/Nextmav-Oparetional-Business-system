-- ===========================================================================
--  0035 - Workspace: business context, safe autosave, and a comment leak
-- ===========================================================================
--
--  Phase 13 is the Workspace module. As with Projects, most of what the
--  screens needed was already in the schema: pages nest, versions snapshot,
--  shares resolve through `page_permission()`, sheets have typed columns, and
--  files carry a folder. The application is where nearly all of the work is.
--
--  Five things are genuinely missing or wrong, and they are here.
--
--  -- 1. A comment on a private page was readable by everybody --------------
--
--  `comments_select` (0016) asks only `can_access_module(org,'workspace')` for
--  a comment whose `page_id` is set. Every other rule in the workspace resolves
--  through `page_permission()`: the page, its versions, its sheet columns, its
--  sheet rows and its shares all do. The comments did not.
--
--  So the HR folder's *contents* were private and the discussion attached to
--  them was not. Nothing has ever written a page comment - the workspace had
--  no comment UI - which is why it has never leaked anything. This phase gives
--  it its first consumer, which is the moment the policy has to be right.
--
--  -- 2. Autosave would have filled the history with itself ----------------
--
--  `snapshot_page_version()` writes a revision on every substantive content
--  change. That is correct for a Save button pressed a few times a day and
--  wrong for an editor that commits on a pause in typing: fifty snapshots of
--  one paragraph being written, and `prune_page_versions` then discards the
--  version somebody actually wanted.
--
--  The fix is to coalesce a continuing edit rather than to snapshot less. If
--  the newest revision was taken recently *by the same person*, that edit is
--  still in progress and its "before" state is already recorded. A different
--  author, or a gap, opens a new revision. The rule lives in the trigger
--  because four routes write `workspace_pages`.
--
--  -- 3. Workspace content had no way to name what it is about -------------
--
--  "Acme Website Requirements" is about Acme Corporation, the Website Redesign
--  project and the deal that paid for it, and the workspace could not say so.
--  `workspace_page_links` is one polymorphic table, deliberately: the question
--  is always "what is this page about", and nine join tables would be nine
--  reads to answer it once.
--
--  -- 4. `v_files` never learned about links -------------------------------
--
--  0034 added `files.external_url` for the projects module, which reads the
--  table directly. The workspace reads `v_files`, so a link filed in a folder
--  came back with no address. Appended, which is the only shape change
--  `CREATE OR REPLACE VIEW` permits.
--
--  -- 5. A sheet column could not say how to present itself ----------------
--
--  Alignment, decimal places, a total under a column, a frozen first column
--  and a computed column are what separates a business spreadsheet from an
--  HTML table. All five are presentation of data that is already stored, so
--  they belong on the column definition rather than in a second table.
--
--  Everything here is additive and idempotent. No column is dropped, no
--  default changes, and every existing row satisfies the new constraints.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  1. A page comment follows the page
-- ---------------------------------------------------------------------------
--
--  Replaces the 0016 policy with one that is strictly narrower for the page
--  case and identical everywhere else. Nobody loses access to a comment on a
--  project, a task, a deal or a ticket.
--
--  `page_permission()` is SECURITY DEFINER and STABLE, and is already called
--  from the policies on `workspace_page_versions`, `workspace_sheet_columns`
--  and `workspace_sheet_rows`, so there is nothing new about calling it here.
--  It returns NULL when the caller has no access at all, which is exactly the
--  test wanted: a comment is readable by anyone who can open what it is on.

DROP POLICY IF EXISTS comments_select ON comments;
CREATE POLICY comments_select ON comments FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      (project_id IS NOT NULL AND public.can_access_module(organization_id, 'projects'))
      OR (task_id    IS NOT NULL AND public.can_access_module(organization_id, 'projects'))
      -- Changed: the module grant is necessary and no longer sufficient.
      OR (page_id    IS NOT NULL AND public.page_permission(page_id) IS NOT NULL)
      OR (deal_id    IS NOT NULL AND public.can_access_module(organization_id, 'crm'))
      OR (ticket_id  IS NOT NULL AND public.can_access_module(organization_id, 'support'))
      OR (project_id IS NULL AND task_id IS NULL AND page_id IS NULL
          AND deal_id IS NULL AND ticket_id IS NULL
          AND public.can_access_module(organization_id, 'workspace'))
    )
  );

/**
 * Posting on a page needs the right to open it.
 *
 * `comments_insert` checks only that the author is the caller, which is the
 * right rule for authorship and says nothing about *where* the comment lands.
 * Without the clause below, somebody who cannot read a private page could
 * still file a comment against it - and then read their own comment back,
 * because `comments_select` admits the author's own row through the page
 * clause only if they can open the page. They could not read it back; they
 * could still put text into somebody else's private document's thread, where
 * it would appear to everyone who can.
 */
DROP POLICY IF EXISTS comments_insert ON comments;
CREATE POLICY comments_insert ON comments FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND author_id = public.auth_member_id(organization_id)
    AND (page_id IS NULL OR public.page_permission(page_id) IS NOT NULL)
  );


-- ---------------------------------------------------------------------------
--  2. Version history that survives autosave
-- ---------------------------------------------------------------------------

/**
 * How long one person's editing session counts as a single revision.
 *
 * Ten minutes: long enough that writing a page in one sitting produces one
 * entry, short enough that "what did this look like before lunch" is still
 * answerable. A colleague editing after you always opens a new revision
 * regardless of the interval, because whose change it was is the thing a
 * history is read for.
 */
CREATE OR REPLACE FUNCTION public.snapshot_page_version()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  newest workspace_page_versions;
BEGIN
  -- Only substantive changes. Starring a page, moving it, or touching
  -- `updated_at` is not a revision anybody wants to scroll past.
  IF NEW.content IS NOT DISTINCT FROM OLD.content
     AND NEW.title IS NOT DISTINCT FROM OLD.title THEN
    RETURN NEW;
  END IF;

  SELECT * INTO newest
  FROM workspace_page_versions
  WHERE page_id = OLD.id
  ORDER BY version DESC
  LIMIT 1;

  /**
   * A continuing edit extends the revision it is part of.
   *
   * The snapshot records the state *before* an edit, so the revision already
   * on file holds the right "before" for this whole session - overwriting it
   * with the state one keystroke ago is what would lose the thing a restore
   * is reaching for. So the row is left exactly as it is and only the page's
   * counter moves on.
   *
   * `edited_by` on the snapshot is the author of the state being recorded,
   * which is `OLD.last_edited_by`. Comparing it against the same field is
   * what makes "the same person is still typing" the question being asked.
   */
  IF newest.id IS NOT NULL
     AND newest.created_at > now() - interval '10 minutes'
     AND newest.edited_by IS NOT DISTINCT FROM OLD.last_edited_by
     AND NEW.last_edited_by IS NOT DISTINCT FROM OLD.last_edited_by
  THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  INSERT INTO workspace_page_versions (page_id, content, title, version, edited_by)
  VALUES (OLD.id, OLD.content, OLD.title, OLD.version, OLD.last_edited_by)
  ON CONFLICT (page_id, version) DO NOTHING;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.snapshot_page_version() IS
  'Records the state before an edit. Consecutive edits by the same person '
  'within ten minutes extend the revision already on file rather than adding '
  'one, so an autosaving editor does not turn the history into a keystroke log.';


-- ---------------------------------------------------------------------------
--  3. What a page is about
-- ---------------------------------------------------------------------------

/**
 * Workspace content, linked to the business records that give it context.
 *
 * -- Why one polymorphic table --------------------------------------------
 *
 * The alternative is nine join tables, one per record type. Every read here
 * is "what is this page about" or "what has been written about this record",
 * and both become nine queries and a union. The write path would be nine
 * endpoints. Nothing is gained: there is no per-type column, and the foreign
 * key a join table would give is bought back below by a trigger that checks
 * the target exists *in this organisation*, which a plain FK cannot express.
 *
 * -- Why the target is not a foreign key ----------------------------------
 *
 * `entity_id` cannot reference nine tables. The `verify_page_link()` trigger
 * resolves the row through the caller's own view of it, so a link can only
 * ever be made to something the person making it can already see - which is
 * a stronger rule than a foreign key, and the one that matters for a tenant
 * boundary.
 */
CREATE TABLE IF NOT EXISTS workspace_page_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  page_id         uuid NOT NULL REFERENCES workspace_pages(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  /**
   * The record's name at the moment it was linked.
   *
   * Denormalised on purpose, and read only as a fallback. A link list has to
   * render nine different record types in one panel; resolving each through
   * its own table means nine reads for a sidebar. The endpoint refreshes the
   * label from the live record when it can, so a renamed company shows its
   * new name; this is what remains when the reader cannot see that record's
   * module at all, which is the common case for a document linked to both a
   * deal and an employee.
   */
  label           text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT page_link_entity_valid CHECK (entity_type IN (
    'company', 'contact', 'deal', 'lead',
    'project', 'task', 'employee', 'invoice', 'ticket', 'department'
  ))
);

-- The same record linked to the same page twice would render as two identical
-- rows with two different remove buttons.
CREATE UNIQUE INDEX IF NOT EXISTS uq_page_link
  ON workspace_page_links (page_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_page_links_page
  ON workspace_page_links (page_id);

-- The reverse read: "what has been written about this customer". Ordered by
-- recency because a record's document list is read newest first.
CREATE INDEX IF NOT EXISTS idx_page_links_entity
  ON workspace_page_links (organization_id, entity_type, entity_id, created_at DESC);

/**
 * The target has to exist, in this organisation.
 *
 * Enforced in a trigger because `entity_id` points at one of ten tables and a
 * CHECK cannot query. SECURITY DEFINER so the lookup is not itself filtered by
 * RLS - the question being asked is "does this row exist in this tenant", and
 * a caller who cannot read a deal must still be told the link is invalid
 * rather than silently getting a dangling row.
 *
 * The caller's right to *see* the target is a separate question, answered in
 * the endpoint: RLS decides what may be linked, this decides what exists.
 */
CREATE OR REPLACE FUNCTION public.verify_page_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  found boolean;
BEGIN
  CASE NEW.entity_type
    WHEN 'company'    THEN SELECT EXISTS (SELECT 1 FROM companies       WHERE id = NEW.entity_id AND organization_id = NEW.organization_id AND deleted_at IS NULL) INTO found;
    WHEN 'contact'    THEN SELECT EXISTS (SELECT 1 FROM contacts        WHERE id = NEW.entity_id AND organization_id = NEW.organization_id AND deleted_at IS NULL) INTO found;
    WHEN 'deal'       THEN SELECT EXISTS (SELECT 1 FROM deals           WHERE id = NEW.entity_id AND organization_id = NEW.organization_id AND deleted_at IS NULL) INTO found;
    WHEN 'lead'       THEN SELECT EXISTS (SELECT 1 FROM leads           WHERE id = NEW.entity_id AND organization_id = NEW.organization_id AND deleted_at IS NULL) INTO found;
    WHEN 'project'    THEN SELECT EXISTS (SELECT 1 FROM projects        WHERE id = NEW.entity_id AND organization_id = NEW.organization_id AND deleted_at IS NULL) INTO found;
    WHEN 'task'       THEN SELECT EXISTS (SELECT 1 FROM tasks           WHERE id = NEW.entity_id AND organization_id = NEW.organization_id AND deleted_at IS NULL) INTO found;
    WHEN 'employee'   THEN SELECT EXISTS (SELECT 1 FROM organization_members WHERE id = NEW.entity_id AND organization_id = NEW.organization_id) INTO found;
    WHEN 'invoice'    THEN SELECT EXISTS (SELECT 1 FROM invoices        WHERE id = NEW.entity_id AND organization_id = NEW.organization_id AND deleted_at IS NULL) INTO found;
    WHEN 'ticket'     THEN SELECT EXISTS (SELECT 1 FROM support_tickets WHERE id = NEW.entity_id AND organization_id = NEW.organization_id AND deleted_at IS NULL) INTO found;
    WHEN 'department' THEN SELECT EXISTS (SELECT 1 FROM departments     WHERE id = NEW.entity_id AND organization_id = NEW.organization_id) INTO found;
    ELSE found := false;
  END CASE;

  IF NOT found THEN
    RAISE EXCEPTION 'That % does not exist in this organisation.', NEW.entity_type
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_verify_page_link ON workspace_page_links;
CREATE TRIGGER trg_verify_page_link
  BEFORE INSERT OR UPDATE ON workspace_page_links
  FOR EACH ROW EXECUTE FUNCTION public.verify_page_link();

ALTER TABLE workspace_page_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_page_links FORCE ROW LEVEL SECURITY;

-- A link is part of the page, so it is readable by anyone who can open the
-- page. It is deliberately *not* gated on the target's module: a document
-- saying "this is about the Halden engagement" is workspace content, and
-- hiding the fact that a link exists would leave a panel that renders a
-- different number of rows depending on who is looking at it.
DROP POLICY IF EXISTS page_links_select ON workspace_page_links;
CREATE POLICY page_links_select ON workspace_page_links FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids())
         AND public.page_permission(page_id) IS NOT NULL);

-- Changing what a page is about is editing the page.
DROP POLICY IF EXISTS page_links_write ON workspace_page_links;
CREATE POLICY page_links_write ON workspace_page_links FOR ALL TO authenticated
  USING (organization_id = ANY (public.auth_org_ids())
         AND public.page_permission(page_id) IN ('edit', 'manage'))
  WITH CHECK (organization_id = ANY (public.auth_org_ids())
              AND public.page_permission(page_id) IN ('edit', 'manage'));


-- ---------------------------------------------------------------------------
--  4. A page can describe itself
-- ---------------------------------------------------------------------------
--
--  `summary` is one line under the title: what this document is for. It is
--  what makes a template gallery legible - a grid of nine names with no
--  description is a grid somebody has to open nine times - and it is the
--  subtitle on a search result and on a folder's contents list.
--
--  `template_category` groups the gallery. Free text with a default rather
--  than an enum: an organisation's own templates will not fit a list decided
--  here, and a category nobody recognises is better than a template filed
--  under the wrong one.

ALTER TABLE workspace_pages
  ADD COLUMN IF NOT EXISTS summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS template_category text;

COMMENT ON COLUMN workspace_pages.summary IS
  'One line describing what the page is for. Shown under the title, in the '
  'template gallery and on a folder''s contents list.';

/**
 * Finding a phrase inside a document.
 *
 * The workspace search has always matched `content ILIKE '%…%'`, which is a
 * sequential scan of every page body in the organisation. Fine at fifty pages
 * and not at five thousand, which is the size this module is meant to reach.
 * pg_trgm has been installed since 0001 and no index has ever used it.
 */
CREATE INDEX IF NOT EXISTS idx_workspace_pages_title_trgm
  ON workspace_pages USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_workspace_pages_content_trgm
  ON workspace_pages USING gin (content gin_trgm_ops);

-- The template gallery's own read.
CREATE INDEX IF NOT EXISTS idx_workspace_pages_templates
  ON workspace_pages (organization_id, template_category)
  WHERE is_template = true AND deleted_at IS NULL;


-- ---------------------------------------------------------------------------
--  5. Sheet columns that can say how to present themselves
-- ---------------------------------------------------------------------------

ALTER TABLE workspace_sheet_columns
  /**
   * Alignment.
   *
   * NULL means "whatever the type implies" - numbers and currency right,
   * everything else left - so an existing sheet keeps the alignment it has
   * and only an explicit choice overrides it. Storing the derived value on
   * every row instead would freeze today's default into data.
   */
  ADD COLUMN IF NOT EXISTS align text,
  /** Decimal places for number and currency. NULL means the type's default. */
  ADD COLUMN IF NOT EXISTS decimals int,
  /**
   * A computed column, written as `=Quantity * Price`.
   *
   * Evaluated in the browser, deliberately. A formula is a presentation of
   * cells that are already stored, so a stored result would be a second copy
   * that goes stale the moment any input changes - and evaluating it in the
   * database would mean an expression language, a dependency graph and a
   * recalculation trigger, which is a spreadsheet engine and not what this is.
   * Cells belonging to a formula column are not editable and are not written.
   */
  ADD COLUMN IF NOT EXISTS formula text,
  /** A total under the column: none, sum, avg, min, max, count, filled. */
  ADD COLUMN IF NOT EXISTS aggregate text NOT NULL DEFAULT 'none',
  /**
   * Freeze panes, expressed as a property of the column rather than a count.
   *
   * A count ("the first two columns are frozen") breaks the moment a column
   * is reordered or hidden, and the grid then freezes whichever two happen to
   * be leftmost. Marking the column itself survives both.
   */
  ADD COLUMN IF NOT EXISTS is_frozen boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sheet_column_align_valid') THEN
    ALTER TABLE workspace_sheet_columns ADD CONSTRAINT sheet_column_align_valid
      CHECK (align IS NULL OR align IN ('left', 'center', 'right'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sheet_column_decimals_valid') THEN
    ALTER TABLE workspace_sheet_columns ADD CONSTRAINT sheet_column_decimals_valid
      CHECK (decimals IS NULL OR decimals BETWEEN 0 AND 6);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sheet_column_aggregate_valid') THEN
    ALTER TABLE workspace_sheet_columns ADD CONSTRAINT sheet_column_aggregate_valid
      CHECK (aggregate IN ('none', 'sum', 'avg', 'min', 'max', 'count', 'filled'));
  END IF;
END $$;


-- ---------------------------------------------------------------------------
--  6. Renaming a file you did not upload
-- ---------------------------------------------------------------------------
--
--  0017 gave `files` an UPDATE policy admitting the uploader and
--  administrators. That is the right rule for a personnel document filed
--  against an employee, and the wrong one for a shared folder: the person who
--  manages the Finance folder could not correct a misspelt filename in it, and
--  the endpoint answered "not found, or you are not the person who uploaded
--  it" - which is true and useless.
--
--  Widened by exactly one clause: somebody who may write in the folder a file
--  is filed in may also rename and describe it. A file with no `page_id`
--  (HR documents, expense receipts, invoice attachments) is unaffected, and
--  `bucket` and `path` remain immutable in the endpoint either way.

DROP POLICY IF EXISTS files_update ON files;
CREATE POLICY files_update ON files FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (uploaded_by = public.auth_member_id(organization_id)
         OR public.is_org_admin(organization_id)
         OR (page_id IS NOT NULL AND public.page_permission(page_id) IN ('edit', 'manage')))
  )
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

/**
 * Deleting one, likewise.
 *
 * 0005's `files_delete` admits the uploader and administrators. Left as it is
 * for everything outside the workspace, and extended to folder managers for
 * the same reason as above: a folder somebody is responsible for is one they
 * have to be able to tidy. 'manage' rather than 'edit', because removing
 * somebody else's upload is the more consequential half of the pair.
 */
DROP POLICY IF EXISTS files_delete ON files;
CREATE POLICY files_delete ON files FOR DELETE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (uploaded_by = public.auth_member_id(organization_id)
         OR public.is_org_admin(organization_id)
         OR (page_id IS NOT NULL AND public.page_permission(page_id) = 'manage'))
  );


-- ---------------------------------------------------------------------------
--  7. The reading views, brought up to date
-- ---------------------------------------------------------------------------
--
--  Columns are appended, never inserted or renamed: Postgres permits adding
--  to the end of a view definition and rejects everything else with "cannot
--  change name of view column".

CREATE OR REPLACE VIEW public.v_workspace_tree
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.organization_id,
  p.space_id,
  p.parent_id,
  p.title,
  p.icon,
  p.colour,
  p.kind,
  p.is_folder,
  p.is_template,
  p.is_starred,
  p.visibility,
  p.department_id,
  p.sort_order,
  p.version,
  p.created_by,
  p.last_edited_by,
  p.created_at,
  p.updated_at,
  d.name                        AS department_name,
  editor.full_name              AS last_edited_by_name,
  creator.full_name             AS created_by_name,
  public.page_permission(p.id)  AS permission,
  (SELECT COUNT(*)::int FROM workspace_pages c
    WHERE c.parent_id = p.id AND c.deleted_at IS NULL) AS child_count,
  (SELECT COUNT(*)::int FROM files f
    WHERE f.page_id = p.id AND f.deleted_at IS NULL)   AS file_count,
  (SELECT COUNT(*)::int FROM workspace_page_shares s
    WHERE s.page_id = p.id)                            AS share_count,
  -- Appended in 0035.
  p.summary,
  p.template_category,
  editor.avatar_url             AS last_edited_by_avatar,
  (SELECT COUNT(*)::int FROM comments c2
    WHERE c2.page_id = p.id AND c2.deleted_at IS NULL) AS comment_count,
  (SELECT COUNT(*)::int FROM workspace_page_links l
    WHERE l.page_id = p.id)                            AS link_count,
  /**
   * How the caller reaches this page.
   *
   * The tree already says what somebody may do; it has never said why. A list
   * headed "Shared with me" cannot be built without it, and neither can the
   * lock icon distinguishing "restricted, and you are on the list" from
   * "restricted to your department". Resolved from the share rows rather than
   * from `visibility`, because an explicit share is what makes the difference.
   */
  EXISTS (
    SELECT 1 FROM workspace_page_shares s2
    WHERE s2.page_id = p.id
      AND (s2.member_id = public.auth_member_id(p.organization_id)
           OR (s2.department_id IS NOT NULL
               AND s2.department_id = public.auth_department_id(p.organization_id)))
  ) AS is_shared_with_me
FROM workspace_pages p
LEFT JOIN departments d           ON d.id = p.department_id
LEFT JOIN organization_members em ON em.id = p.last_edited_by
LEFT JOIN profiles editor         ON editor.id = em.user_id
LEFT JOIN organization_members cm ON cm.id = p.created_by
LEFT JOIN profiles creator        ON creator.id = cm.user_id
WHERE p.deleted_at IS NULL;

GRANT SELECT ON public.v_workspace_tree TO authenticated;

CREATE OR REPLACE VIEW public.v_files
WITH (security_invoker = true) AS
SELECT
  f.id,
  f.organization_id,
  f.bucket,
  f.path,
  f.filename,
  f.mime_type,
  f.size_bytes,
  f.description,
  f.version,
  f.page_id,
  f.project_id,
  f.task_id,
  f.ticket_id,
  f.member_id,
  f.is_confidential,
  f.uploaded_by,
  f.created_at,
  f.updated_at,
  p.title       AS folder_title,
  up.full_name  AS uploaded_by_name,
  up.avatar_url AS uploaded_by_avatar,
  proj.name     AS project_name,
  f.folder,
  f.is_client_visible,
  -- Appended in 0035. A workspace file panel that lists links and uploads
  -- together reads this view, and 0034 added the column to the table only.
  f.external_url
FROM files f
LEFT JOIN workspace_pages p        ON p.id = f.page_id
LEFT JOIN projects proj            ON proj.id = f.project_id
LEFT JOIN organization_members om  ON om.id = f.uploaded_by
LEFT JOIN profiles up              ON up.id = om.user_id
WHERE f.deleted_at IS NULL;

GRANT SELECT ON public.v_files TO authenticated;


-- ---------------------------------------------------------------------------
--  8. Live updates for the pieces the workspace now shows
-- ---------------------------------------------------------------------------
--
--  `workspace_pages` and `files` joined the publication in 0020. The comment
--  thread and the sheet grid are the two surfaces where a colleague's change
--  arriving late is most obviously wrong, and neither table is in it.
--
--  `comments` has been in the publication since 0006. The two sheet tables
--  have not been in any of them.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workspace_sheet_rows', 'workspace_sheet_columns', 'workspace_page_links'
  ] LOOP
    -- REPLICA IDENTITY FULL so an UPDATE arrives with its old row, which is
    -- what makes a filter on a non-key column work at all.
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
