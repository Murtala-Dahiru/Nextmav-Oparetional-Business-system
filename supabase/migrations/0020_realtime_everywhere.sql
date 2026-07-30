-- ═══════════════════════════════════════════════════════════════════════════
--  0020 — Realtime for the remaining modules
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ── Reversing a deliberate decision, deliberately ────────────────────────
--
--  0006 published nine tables and explicitly declined the rest:
--
--    "Only tables where a live update genuinely changes what someone is
--     looking at are published. Adding every table would mean every write fans
--     out to every connected client and is then discarded by RLS — cost with
--     no benefit."
--
--  That reasoning was sound and the trade-off has changed. The product is now
--  expected to update every module without a refresh, and the argument against
--  — that two people rarely edit the same lead — is about *likelihood*, not
--  about correctness. When it does happen, the person looking at the stale row
--  overwrites somebody's work, and "rare" is exactly the kind of bug that gets
--  reported once a quarter and never reproduced.
--
--  So the cost is accepted, with its shape written down rather than forgotten:
--
--    · Every write to these tables is delivered to every connected client in
--      the same organization and discarded by RLS for everyone else. RLS bounds
--      the blast radius to a tenant, not to a screen.
--
--    · The subscribing hooks are the second bound. `useModuleRealtime` debounces
--      at 400ms and refetches once, so a bulk import of five hundred products
--      costs one refetch per connected client, not five hundred.
--
--    · The tables genuinely excluded remain excluded: `audit_log` (append-only,
--      nothing renders it live), `org_settings` (changes arrive with the
--      session), `invoice_line_items` (an invoice's own row already moves when
--      its lines do).
--
--  `REPLICA IDENTITY FULL` on each, for the reason 0018 gives: without it an
--  UPDATE carries only the primary key and a filter on any other column matches
--  nothing, so a per-project or per-warehouse subscription would receive
--  inserts and silently miss every edit.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- CRM
    'leads', 'contacts', 'companies', 'deals',
    -- Inventory
    'products', 'warehouses', 'suppliers', 'stock_movements', 'purchase_orders',
    -- Calendar
    'calendar_events',
    -- Workspace
    'workspace_pages', 'files',
    -- HR
    'attendance_records', 'departments'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);

      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END IF;
  END LOOP;
END $$;
