-- ═══════════════════════════════════════════════════════════════════════════
--  Two workspace features that were built but had nowhere to store anything
-- ═══════════════════════════════════════════════════════════════════════════
--
--  The page editor has always offered an icon colour, and the page list has
--  always had a star control and sorted starred pages to the top. Neither
--  column existed.
--
--  Both failed silently in the same way: the request succeeded, the API
--  answered 200, and the value was discarded. Starring a page appeared to work
--  until the list reloaded; the colour picker set an icon colour that reverted
--  on every read. Nothing surfaced an error because nothing went wrong at the
--  transport layer — the field simply had no column to land in.
--
--  Adding the columns is what makes the existing UI honest. No behaviour is
--  being introduced here that the product did not already claim to have.

ALTER TABLE public.workspace_pages
  ADD COLUMN IF NOT EXISTS colour text NOT NULL DEFAULT '#10b981';

COMMENT ON COLUMN public.workspace_pages.colour IS
  'Icon colour for the page, set in the editor. Spelled as the rest of the '
  'schema spells it (see calendar_events.colour); the API maps the client''s '
  'American spelling at the boundary.';

/**
 * Starring is a property of the page, not of the viewer.
 *
 * That matches the control the UI already presents — a star on the page row,
 * shared by everyone in the workspace, like pinning a message in a channel.
 * Per-person favourites would be a different feature needing its own table,
 * and inventing one here would change what the existing button means.
 */
ALTER TABLE public.workspace_pages
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false;

-- Starred pages are sorted to the top of every list, so the ordering is worth
-- supporting with an index once a workspace has more than a handful of pages.
-- Unqualified table name, matching every other index in the schema.
CREATE INDEX IF NOT EXISTS idx_workspace_pages_starred
  ON workspace_pages (organization_id, is_starred DESC, updated_at DESC)
  WHERE deleted_at IS NULL;
