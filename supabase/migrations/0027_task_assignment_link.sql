-- ═══════════════════════════════════════════════════════════════════════════
--  0027 - The assignment notification could not be opened
-- ═══════════════════════════════════════════════════════════════════════════
--
--  `notify_task_assignment()` has written a row on every assignment since
--  0004, and has never written a `link`. The header opens a notification by
--  parsing that field and returns early when it is null, so "New task
--  assigned" was the one notification in the product that did nothing when
--  clicked.
--
--  Every other assignment notification in the schema already carries one:
--  `notify_ticket_change()` writes `/dashboard?module=support&ticket=<id>`,
--  and 0016's `notify_members()` takes the link as a parameter precisely
--  because the ones written before it had proved the point. This is the last
--  producer still on the pre-0016 shape.
--
--  That matters more now than it did, because the assignment notification is
--  the first step of a workflow rather than a courtesy: work is assigned, the
--  bell counts it, the reader adds it to their own list from the tray, and
--  the task stays the source of truth. A step that cannot be clicked is a
--  workflow with a hole in it.
--
--  Nothing else about the trigger changes. It still declines to tell you
--  about work you assigned to yourself.
--
--  Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.assignee_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) THEN
    -- Assigning something to yourself does not warrant telling you about it.
    IF NEW.assignee_id <> COALESCE(public.auth_member_id(NEW.organization_id), '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO notifications (
        organization_id, recipient_id, type, title, body, entity_type, entity_id, link
      )
      VALUES (
        NEW.organization_id, NEW.assignee_id, 'task_assigned',
        'New task assigned', NEW.title, 'task', NEW.id,
        '/dashboard?module=projects&task=' || NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

/**
 * Backfill the ones already sent.
 *
 * Only rows that are still unread: a notification somebody has already dealt
 * with does not need to become clickable, and rewriting read history is a
 * larger claim than fixing a broken control.
 */
UPDATE notifications
   SET link = '/dashboard?module=projects&task=' || entity_id
 WHERE type = 'task_assigned'
   AND entity_type = 'task'
   AND entity_id IS NOT NULL
   AND link IS NULL
   AND is_read = false;
