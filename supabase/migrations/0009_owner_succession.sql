-- ═══════════════════════════════════════════════════════════════════════════
--  Owner succession when a user account is deleted
-- ═══════════════════════════════════════════════════════════════════════════
--
--  prevent_last_owner_removal() (0002) protects a live organization from
--  losing its last owner, and already exempts one case: the cascade from
--  deleting the organization itself. It did not exempt the other one —
--  deleting the *user*.
--
--  The chain is auth.users → profiles → organization_members, all ON DELETE
--  CASCADE. When a sole owner's account is deleted the cascade reaches their
--  membership while the organization is still there, the trigger raises
--  check_violation, and the whole DELETE aborts. The account cannot be
--  removed at all.
--
--  Two consequences, both real:
--
--    · A user who owns an organization can never be deleted. That blocks
--      erasure requests, and it blocks any automated cleanup — app-verify
--      swallowed the failure, so every run leaked its throwaway accounts and
--      their organizations into the project.
--
--    · The rule was doing the wrong thing for the case it was written to
--      protect. Refusing does not keep the organization administrable; it
--      just keeps a departed person's account alive as its only owner.
--
--  What should happen instead is succession, not refusal:
--
--    · Someone else is still there  → promote the most senior of them.
--      Longest-serving administrator first, then longest-serving member.
--      The organization keeps running under a real owner.
--
--    · Nobody is left               → the organization is an empty shell.
--      Remove it, rather than leave an unreachable tenant behind.
--
--  The deliberate rule the original migration encodes is unchanged: a person
--  acting on a live organization still cannot demote, deactivate or remove
--  its last owner. Only the account-deletion cascade is exempted.

-- ───────────────────────────────────────────────────────────────────────────
--  1. Exempt the account-deletion cascade, and promote a successor
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  remaining int;
  successor uuid;
BEGIN
  -- Deleting the organization itself cascades to its memberships. Guarding
  -- those would make an organization impossible to delete: the cascade removes
  -- the owner, the trigger refuses, and the whole DELETE aborts. The parent row
  -- is already gone by the time the cascade fires, so its absence identifies
  -- this case precisely.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id) THEN
    RETURN OLD;
  END IF;

  -- Deleting the user cascades the same way, through profiles. Identified the
  -- same way: the profile row is already gone. Refusing here would make the
  -- account undeletable, so hand the organization to someone else instead.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN

    IF OLD.role = 'owner' THEN
      SELECT count(*) INTO remaining
      FROM organization_members
      WHERE organization_id = OLD.organization_id
        AND role = 'owner' AND is_active = true AND id <> OLD.id;

      IF remaining = 0 THEN
        -- Most senior survivor: administrators before ordinary members, and
        -- within each, whoever has been here longest.
        SELECT id INTO successor
        FROM organization_members
        WHERE organization_id = OLD.organization_id
          AND is_active = true
          AND id <> OLD.id
        ORDER BY (role = 'administrator') DESC, joined_at ASC
        LIMIT 1;

        IF successor IS NOT NULL THEN
          UPDATE organization_members
          SET role = 'owner'
          WHERE id = successor;
        END IF;
        -- No successor: the organization is left empty and is removed by
        -- trg_drop_empty_organization below, after this row is actually gone.
      END IF;
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.role = 'owner' AND NEW.role = 'owner' AND NEW.is_active THEN
    RETURN NEW;
  END IF;

  IF OLD.role <> 'owner' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*) INTO remaining
  FROM organization_members
  WHERE organization_id = OLD.organization_id
    AND role = 'owner' AND is_active = true AND id <> OLD.id;

  IF remaining = 0 THEN
    RAISE EXCEPTION
      'Cannot remove or demote the last owner. Promote another member to owner first.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
--  2. Remove an organization once its last member is gone
-- ───────────────────────────────────────────────────────────────────────────
--
--  AFTER DELETE rather than BEFORE: the departing row must already be gone
--  before the count is meaningful, and deleting the organization from a
--  BEFORE trigger would cascade back onto the row currently being deleted.

CREATE OR REPLACE FUNCTION public.drop_empty_organization()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only when the organization still exists: if it is itself being deleted,
  -- this cascade is a consequence of that and there is nothing to do.
  IF EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM organization_members
       WHERE organization_id = OLD.organization_id
     ) THEN
    DELETE FROM organizations WHERE id = OLD.organization_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_drop_empty_organization ON organization_members;
CREATE TRIGGER trg_drop_empty_organization
  AFTER DELETE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION public.drop_empty_organization();

-- ───────────────────────────────────────────────────────────────────────────
--  3. Deleting an organization
-- ───────────────────────────────────────────────────────────────────────────
--
--  Same shape as the owner rule, in the inventory tables. Two foreign keys
--  are deliberately ON DELETE RESTRICT:
--
--      purchase_orders.supplier_id      → suppliers
--      purchase_order_items.product_id  → products
--
--  For a live organization that is right. Deleting a product that appears on
--  a purchase order would silently rewrite what was ordered, so the database
--  refuses and the user is told to keep the record.
--
--  For a whole tenant it is wrong. DELETE FROM organizations cascades to
--  products, RESTRICT stops the cascade, and the delete aborts with a foreign
--  key error naming purchase_order_items — an error about product history
--  raised while trying to close an account. In practice: any organization
--  that has ever raised a purchase order cannot be removed, which blocks
--  offboarding and erasure requests.
--
--  Relaxing the constraints would trade a real safeguard for the sake of a
--  rare operation. Instead this tears the order records down first, in
--  dependency order, so the cascade meets nothing that RESTRICT protects.
--
--  SECURITY DEFINER, and deliberately not granted to `authenticated`: this is
--  an operator action. Exposing it to the API would hand any owner a button
--  that erases the tenant and every record in it.

CREATE OR REPLACE FUNCTION public.delete_organization(org_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = org_id) THEN
    RAISE EXCEPTION 'Organization % does not exist.', org_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Children of the RESTRICT edges first, deepest last-referenced first.
  DELETE FROM purchase_order_items
  WHERE order_id IN (SELECT id FROM purchase_orders WHERE organization_id = org_id);

  DELETE FROM purchase_orders WHERE organization_id = org_id;

  -- Everything else is ON DELETE CASCADE from the organization.
  DELETE FROM organizations WHERE id = org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_organization(uuid) FROM public;
REVOKE ALL ON FUNCTION public.delete_organization(uuid) FROM authenticated;
