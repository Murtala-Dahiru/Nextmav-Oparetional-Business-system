-- ═══════════════════════════════════════════════════════════════════════════
--  0045 - The document rule was only half a rule
-- ═══════════════════════════════════════════════════════════════════════════
--
--  `employee_checklist_items.requires_document` exists so that "signed
--  contract on file" means the file. `PATCH /api/hr/checklists/items/[id]`
--  refuses to complete such a step without one, and `hr:verify` asserts it.
--
--  ── The hole, found by looking at the screen ────────────────────────────
--
--  0041 made every checklist step a to-do in somebody's My Work, and made the
--  two tick each other off. So there are **two** ways to complete a step, and
--  only one of them went past the check: ticking the to-do fires
--  `sync_todo_to_checklist_item()`, which writes `is_done = true` straight into
--  the row.
--
--  The onboarding board showed "Signed contract on file" ticked, with no
--  document, after the verification harness ticked the to-do. Nothing errored.
--  That is the exact shape this repository keeps paying for: a rule enforced at
--  one door of two.
--
--  ── Why the trigger raises rather than skipping ─────────────────────────
--
--  Silently declining to tick the step would leave the person's to-do complete
--  and the company's checklist open, with nothing on either screen explaining
--  why. Raising means the tick in My Work *fails*, with the same sentence the
--  API gives - "This step needs a document attached before it can be
--  completed" - so the rule has one wording as well as one implementation.
--
--  A step that requires nothing is unaffected, and unticking is always allowed:
--  reopening a step cannot be gated on evidence.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_todo_to_checklist_item()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item employee_checklist_items%ROWTYPE;
BEGIN
  IF NEW.source_module <> 'hr'
     OR NEW.source_type NOT IN ('onboarding_task', 'offboarding_task')
     OR NEW.is_done IS NOT DISTINCT FROM OLD.is_done THEN
    RETURN NEW;
  END IF;

  SELECT * INTO item FROM employee_checklist_items WHERE id = NEW.source_id;
  IF NOT FOUND THEN
    /* The step was deleted and the personal reminder outlived it, which 0041
       allows on purpose. Nothing to sync. */
    RETURN NEW;
  END IF;

  /**
   * The same refusal the endpoint gives, in the same words.
   *
   * Only on completion: reopening a step is never gated, and a step that
   * requires no document is unaffected.
   */
  IF NEW.is_done
     AND item.requires_document
     AND item.document_file_id IS NULL THEN
    RAISE EXCEPTION 'This step needs a document attached before it can be completed.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE employee_checklist_items
     SET is_done      = NEW.is_done,
         completed_at = CASE WHEN NEW.is_done THEN now() ELSE NULL END,
         completed_by = CASE WHEN NEW.is_done THEN NEW.member_id ELSE NULL END
   WHERE id = NEW.source_id AND is_done IS DISTINCT FROM NEW.is_done;

  RETURN NEW;
END;
$$;

/**
 * Reopen the steps that were completed through the hole.
 *
 * Any step that requires a document, has none, and is nonetheless ticked was
 * ticked from My Work before this migration - the API path could not have
 * produced it. Reopening is the honest state: the contract is not on file.
 *
 * Their to-dos are reopened with them, or the two would disagree from the
 * moment this runs.
 */
UPDATE todos t
   SET is_done = false, completed_at = NULL
  FROM employee_checklist_items i
 WHERE t.id = i.todo_id
   AND i.is_done
   AND i.requires_document
   AND i.document_file_id IS NULL;

UPDATE employee_checklist_items
   SET is_done = false, completed_at = NULL, completed_by = NULL
 WHERE is_done
   AND requires_document
   AND document_file_id IS NULL;
