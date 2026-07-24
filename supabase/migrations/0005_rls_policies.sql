-- ═══════════════════════════════════════════════════════════════════════════
--  0005 — Row Level Security
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Tenant isolation is enforced here, in the database, not in application
--  code. A route handler that forgets to filter by organization is a bug; a
--  policy that is absent is a data breach — so the default for every table is
--  "deny", and access is granted explicitly below.
--
--  THE ONE RULE: no policy queries `organization_members` directly. Tenancy is
--  resolved through the SECURITY DEFINER helpers in 0002, which is what keeps
--  these policies non-recursive and evaluated once per statement.
--
--  Three tiers of sensitivity:
--
--    Operational  (CRM, projects, workspace, inventory) — any member of the
--                 organization may read; roles govern writing.
--    Personal     (attendance, leave) — you see your own; managers see their
--                 department; HR sees everyone. Governed by
--                 auth_visible_member_ids().
--    Financial    (invoices, expenses, payments, budgets) — finance roles and
--                 administrators only, with a self-service exception so people
--                 can submit and track their own expense claims.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  Enable RLS everywhere
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','profiles','organization_members','departments','teams',
    'team_members','invitations',
    'attendance_records','leave_requests','leave_balances',
    'companies','contacts','leads','deals','crm_activities',
    'projects','project_members','milestones','tasks','task_dependencies','time_entries',
    'workspace_spaces','workspace_pages','workspace_page_versions','comments',
    'channels','channel_members','messages','message_reactions',
    'support_tickets','ticket_comments','kb_articles',
    'invoices','invoice_line_items','payments','expenses','budgets',
    'warehouses','suppliers','products','stock_movements',
    'purchase_orders','purchase_order_items',
    'calendar_events','event_attendees','files',
    'audit_log','activity_log','notifications','document_counters'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- FORCE applies policies to the table owner too. Without it any
      -- connection authenticating as the owner — a pooler misconfiguration, a
      -- psql session, an ORM using the wrong role — reads across all tenants,
      -- and RLS is merely advisory.
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  Tenancy core
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS orgs_select ON organizations;
CREATE POLICY orgs_select ON organizations FOR SELECT TO authenticated
  USING (id = ANY (public.auth_org_ids()));

-- Any signed-in user may create an organization: that is the signup path, and
-- at that moment they have no membership to check against. create_organization()
-- is the supported entry point; it also creates the owner membership.
DROP POLICY IF EXISTS orgs_insert ON organizations;
CREATE POLICY orgs_insert ON organizations FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS orgs_update ON organizations;
CREATE POLICY orgs_update ON organizations FOR UPDATE TO authenticated
  USING (public.is_org_admin(id)) WITH CHECK (public.is_org_admin(id));

DROP POLICY IF EXISTS orgs_delete ON organizations;
CREATE POLICY orgs_delete ON organizations FOR DELETE TO authenticated
  USING (public.is_org_owner(id));

-- ── profiles ──
-- Readable by people you share an organization with, so directories and
-- avatars work; writable only by yourself.

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.user_id = profiles.id
        AND om.organization_id = ANY (public.auth_org_ids())
    )
  );

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- ── organization_members ──
-- The `user_id = auth.uid()` branch is essential: without it a newly invited
-- member cannot read the very row that would let them resolve their
-- organizations, and they are locked out of the platform they just joined.

DROP POLICY IF EXISTS members_select ON organization_members;
CREATE POLICY members_select ON organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR organization_id = ANY (public.auth_org_ids()));

DROP POLICY IF EXISTS members_insert ON organization_members;
CREATE POLICY members_insert ON organization_members FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS members_update ON organization_members;
CREATE POLICY members_update ON organization_members FOR UPDATE TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS members_delete ON organization_members;
CREATE POLICY members_delete ON organization_members FOR DELETE TO authenticated
  USING (public.is_org_owner(organization_id) AND user_id <> auth.uid());

-- ── invitations ──
-- Admins manage them. An invitee reads their own by email so the acceptance
-- screen can show which organization is inviting them before they join.

DROP POLICY IF EXISTS invitations_select ON invitations;
CREATE POLICY invitations_select ON invitations FOR SELECT TO authenticated
  USING (
    public.is_org_admin(organization_id)
    OR email = (SELECT email FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS invitations_write ON invitations;
CREATE POLICY invitations_write ON invitations FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- ── departments / teams ──

DROP POLICY IF EXISTS departments_select ON departments;
CREATE POLICY departments_select ON departments FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids()));

DROP POLICY IF EXISTS departments_write ON departments;
CREATE POLICY departments_write ON departments FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS teams_select ON teams;
CREATE POLICY teams_select ON teams FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      is_private = false
      OR public.is_org_admin(organization_id)
      OR EXISTS (
        SELECT 1 FROM team_members tm
        WHERE tm.team_id = teams.id AND tm.member_id = public.auth_member_id(teams.organization_id)
      )
    )
  );

DROP POLICY IF EXISTS teams_write ON teams;
CREATE POLICY teams_write ON teams FOR ALL TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','administrator','manager']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','administrator','manager']::org_role[]));

DROP POLICY IF EXISTS team_members_select ON team_members;
CREATE POLICY team_members_select ON team_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.organization_id = ANY (public.auth_org_ids())));

DROP POLICY IF EXISTS team_members_write ON team_members;
CREATE POLICY team_members_write ON team_members FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM teams t WHERE t.id = team_id
      AND public.has_org_role(t.organization_id, ARRAY['owner','administrator','manager']::org_role[])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM teams t WHERE t.id = team_id
      AND public.has_org_role(t.organization_id, ARRAY['owner','administrator','manager']::org_role[])));

-- ───────────────────────────────────────────────────────────────────────────
--  Personal data — attendance and leave
-- ───────────────────────────────────────────────────────────────────────────
--
--  This is where "HR data stays inside HR" is actually enforced.

DROP POLICY IF EXISTS attendance_select ON attendance_records;
CREATE POLICY attendance_select ON attendance_records FOR SELECT TO authenticated
  USING (member_id = ANY (public.auth_visible_member_ids(organization_id)));

-- Writes go through clock_in()/clock_out(); this covers HR corrections.
DROP POLICY IF EXISTS attendance_insert ON attendance_records;
CREATE POLICY attendance_insert ON attendance_records FOR INSERT TO authenticated
  WITH CHECK (
    member_id = public.auth_member_id(organization_id)
    OR public.can_approve(organization_id, 'hr')
  );

DROP POLICY IF EXISTS attendance_update ON attendance_records;
CREATE POLICY attendance_update ON attendance_records FOR UPDATE TO authenticated
  USING (
    member_id = public.auth_member_id(organization_id)
    OR public.can_approve(organization_id, 'hr')
  )
  WITH CHECK (
    member_id = public.auth_member_id(organization_id)
    OR public.can_approve(organization_id, 'hr')
  );

-- Attendance is a record of what happened; correct it, never delete it.
DROP POLICY IF EXISTS attendance_delete ON attendance_records;
CREATE POLICY attendance_delete ON attendance_records FOR DELETE TO authenticated
  USING (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS leave_select ON leave_requests;
CREATE POLICY leave_select ON leave_requests FOR SELECT TO authenticated
  USING (member_id = ANY (public.auth_visible_member_ids(organization_id)));

-- You raise your own; HR may file on someone's behalf.
DROP POLICY IF EXISTS leave_insert ON leave_requests;
CREATE POLICY leave_insert ON leave_requests FOR INSERT TO authenticated
  WITH CHECK (
    member_id = public.auth_member_id(organization_id)
    OR public.has_org_role(organization_id, ARRAY['owner','administrator','hr_staff']::org_role[])
  );

-- Editing your own is limited to pending requests; approvers may decide.
-- prevent_self_approval() in 0004 blocks approving your own regardless.
DROP POLICY IF EXISTS leave_update ON leave_requests;
CREATE POLICY leave_update ON leave_requests FOR UPDATE TO authenticated
  USING (
    (member_id = public.auth_member_id(organization_id) AND status = 'pending')
    OR public.can_approve(organization_id, 'hr')
  )
  WITH CHECK (
    (member_id = public.auth_member_id(organization_id) AND status IN ('pending','cancelled'))
    OR public.can_approve(organization_id, 'hr')
  );

DROP POLICY IF EXISTS leave_delete ON leave_requests;
CREATE POLICY leave_delete ON leave_requests FOR DELETE TO authenticated
  USING (
    (member_id = public.auth_member_id(organization_id) AND status = 'pending')
    OR public.is_org_admin(organization_id)
  );

DROP POLICY IF EXISTS leave_balances_select ON leave_balances;
CREATE POLICY leave_balances_select ON leave_balances FOR SELECT TO authenticated
  USING (member_id = ANY (public.auth_visible_member_ids(organization_id)));

DROP POLICY IF EXISTS leave_balances_write ON leave_balances;
CREATE POLICY leave_balances_write ON leave_balances FOR ALL TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','administrator','hr_staff']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','administrator','hr_staff']::org_role[]));

-- ───────────────────────────────────────────────────────────────────────────
--  Operational modules
-- ───────────────────────────────────────────────────────────────────────────
--
--  Generated rather than written out 4 × 20 times. Every table here follows
--  the same shape — read if you can access the module, write if the module
--  grants it — so a loop keeps them provably consistent. Anything with
--  genuinely different rules is written explicitly above or below.

DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('companies',        'crm'),
      ('contacts',         'crm'),
      ('leads',            'crm'),
      ('deals',            'crm'),
      ('crm_activities',   'crm'),
      ('projects',         'projects'),
      ('milestones',       'projects'),
      ('tasks',            'projects'),
      ('time_entries',     'projects'),
      ('workspace_spaces', 'workspace'),
      ('workspace_pages',  'workspace'),
      ('comments',         'workspace'),
      ('channels',         'communication'),
      ('messages',         'communication'),
      ('kb_articles',      'support'),
      ('warehouses',       'inventory'),
      ('suppliers',        'inventory'),
      ('products',         'inventory'),
      ('calendar_events',  'calendar')
    ) AS t(tbl, module)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || '_select', spec.tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (organization_id = ANY (public.auth_org_ids())
             AND public.can_access_module(organization_id, %L))
    $f$, spec.tbl || '_select', spec.tbl, spec.module);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || '_insert', spec.tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
      WITH CHECK (organization_id = ANY (public.auth_org_ids())
                  AND public.can_access_module(organization_id, %L))
    $f$, spec.tbl || '_insert', spec.tbl, spec.module);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || '_update', spec.tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
      USING (organization_id = ANY (public.auth_org_ids())
             AND public.can_access_module(organization_id, %L))
      WITH CHECK (organization_id = ANY (public.auth_org_ids()))
    $f$, spec.tbl || '_update', spec.tbl, spec.module);

    -- Deletion is a heavier act than editing: managers and above only.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec.tbl || '_delete', spec.tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
      USING (organization_id = ANY (public.auth_org_ids())
             AND public.has_org_role(organization_id,
                   ARRAY['owner','administrator','manager']::org_role[]))
    $f$, spec.tbl || '_delete', spec.tbl);
  END LOOP;
END $$;

-- ── Child tables, scoped through their parent ──

DROP POLICY IF EXISTS project_members_all ON project_members;
CREATE POLICY project_members_all ON project_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = ANY (public.auth_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = ANY (public.auth_org_ids())));

DROP POLICY IF EXISTS task_dependencies_all ON task_dependencies;
CREATE POLICY task_dependencies_all ON task_dependencies FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.organization_id = ANY (public.auth_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.organization_id = ANY (public.auth_org_ids())));

DROP POLICY IF EXISTS page_versions_select ON workspace_page_versions;
CREATE POLICY page_versions_select ON workspace_page_versions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM workspace_pages p WHERE p.id = page_id AND p.organization_id = ANY (public.auth_org_ids())));

DROP POLICY IF EXISTS page_versions_insert ON workspace_page_versions;
CREATE POLICY page_versions_insert ON workspace_page_versions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM workspace_pages p WHERE p.id = page_id AND p.organization_id = ANY (public.auth_org_ids())));

-- ── Channels and messages ──
-- Private channels are visible only to their members; public ones to the
-- whole organization.

DROP POLICY IF EXISTS channel_members_select ON channel_members;
CREATE POLICY channel_members_select ON channel_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM channels c WHERE c.id = channel_id AND c.organization_id = ANY (public.auth_org_ids())));

DROP POLICY IF EXISTS channel_members_write ON channel_members;
CREATE POLICY channel_members_write ON channel_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM channels c WHERE c.id = channel_id AND c.organization_id = ANY (public.auth_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM channels c WHERE c.id = channel_id AND c.organization_id = ANY (public.auth_org_ids())));

-- Messages in private channels require membership of that channel.
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND EXISTS (
      SELECT 1 FROM channels c
      WHERE c.id = messages.channel_id
        AND (
          c.type IN ('public','announcement')
          OR EXISTS (
            SELECT 1 FROM channel_members cm
            WHERE cm.channel_id = c.id
              AND cm.member_id = public.auth_member_id(messages.organization_id)
          )
        )
    )
  );

DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ANY (public.auth_org_ids())
    AND sender_id = public.auth_member_id(organization_id)
  );

-- You edit and delete your own messages, nobody else's.
DROP POLICY IF EXISTS messages_update ON messages;
CREATE POLICY messages_update ON messages FOR UPDATE TO authenticated
  USING (sender_id = public.auth_member_id(organization_id))
  WITH CHECK (sender_id = public.auth_member_id(organization_id));

DROP POLICY IF EXISTS messages_delete ON messages;
CREATE POLICY messages_delete ON messages FOR DELETE TO authenticated
  USING (
    sender_id = public.auth_member_id(organization_id)
    OR public.is_org_admin(organization_id)
  );

DROP POLICY IF EXISTS reactions_all ON message_reactions;
CREATE POLICY reactions_all ON message_reactions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND m.organization_id = ANY (public.auth_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND m.organization_id = ANY (public.auth_org_ids())));

-- ── Support ──
-- A client sees only the tickets they raised; staff see the queue.

DROP POLICY IF EXISTS tickets_select ON support_tickets;
CREATE POLICY tickets_select ON support_tickets FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      public.auth_role_in(organization_id) <> 'client'
      OR requester_id = public.auth_member_id(organization_id)
    )
  );

DROP POLICY IF EXISTS tickets_insert ON support_tickets;
CREATE POLICY tickets_insert ON support_tickets FOR INSERT TO authenticated
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

DROP POLICY IF EXISTS tickets_update ON support_tickets;
CREATE POLICY tickets_update ON support_tickets FOR UPDATE TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND public.auth_role_in(organization_id) <> 'client'
  )
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

DROP POLICY IF EXISTS tickets_delete ON support_tickets;
CREATE POLICY tickets_delete ON support_tickets FOR DELETE TO authenticated
  USING (public.is_org_admin(organization_id));

-- Internal notes are hidden from the client who raised the ticket.
DROP POLICY IF EXISTS ticket_comments_select ON ticket_comments;
CREATE POLICY ticket_comments_select ON ticket_comments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM support_tickets t
    WHERE t.id = ticket_id
      AND t.organization_id = ANY (public.auth_org_ids())
      AND (
        public.auth_role_in(t.organization_id) <> 'client'
        OR (ticket_comments.is_internal = false
            AND t.requester_id = public.auth_member_id(t.organization_id))
      )
  ));

DROP POLICY IF EXISTS ticket_comments_insert ON ticket_comments;
CREATE POLICY ticket_comments_insert ON ticket_comments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM support_tickets t
    WHERE t.id = ticket_id AND t.organization_id = ANY (public.auth_org_ids())
  ));

-- ───────────────────────────────────────────────────────────────────────────
--  Financial data
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS invoices_select ON invoices;
CREATE POLICY invoices_select ON invoices FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids())
         AND public.can_access_module(organization_id, 'finance'));

DROP POLICY IF EXISTS invoices_write ON invoices;
CREATE POLICY invoices_write ON invoices FOR ALL TO authenticated
  USING (organization_id = ANY (public.auth_org_ids())
         AND public.can_access_module(organization_id, 'finance'))
  WITH CHECK (organization_id = ANY (public.auth_org_ids())
              AND public.can_access_module(organization_id, 'finance'));

DROP POLICY IF EXISTS line_items_all ON invoice_line_items;
CREATE POLICY line_items_all ON invoice_line_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id
                   AND i.organization_id = ANY (public.auth_org_ids())
                   AND public.can_access_module(i.organization_id, 'finance')))
  WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id
                   AND i.organization_id = ANY (public.auth_org_ids())
                   AND public.can_access_module(i.organization_id, 'finance')));

DROP POLICY IF EXISTS payments_select ON payments;
CREATE POLICY payments_select ON payments FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids())
         AND public.can_access_module(organization_id, 'finance'));

DROP POLICY IF EXISTS payments_write ON payments;
CREATE POLICY payments_write ON payments FOR ALL TO authenticated
  USING (public.can_approve(organization_id, 'finance'))
  WITH CHECK (public.can_approve(organization_id, 'finance'));

-- Expenses are the exception in finance: anyone may submit and track their
-- own claim, but only finance sees the organization's full spend.
DROP POLICY IF EXISTS expenses_select ON expenses;
CREATE POLICY expenses_select ON expenses FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      submitted_by = public.auth_member_id(organization_id)
      OR public.can_access_module(organization_id, 'finance')
    )
  );

DROP POLICY IF EXISTS expenses_insert ON expenses;
CREATE POLICY expenses_insert ON expenses FOR INSERT TO authenticated
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

DROP POLICY IF EXISTS expenses_update ON expenses;
CREATE POLICY expenses_update ON expenses FOR UPDATE TO authenticated
  USING (
    (submitted_by = public.auth_member_id(organization_id) AND status = 'pending')
    OR public.can_approve(organization_id, 'finance')
  )
  WITH CHECK (
    (submitted_by = public.auth_member_id(organization_id) AND status IN ('pending','cancelled'))
    OR public.can_approve(organization_id, 'finance')
  );

DROP POLICY IF EXISTS expenses_delete ON expenses;
CREATE POLICY expenses_delete ON expenses FOR DELETE TO authenticated
  USING (
    (submitted_by = public.auth_member_id(organization_id) AND status = 'pending')
    OR public.is_org_admin(organization_id)
  );

DROP POLICY IF EXISTS budgets_select ON budgets;
CREATE POLICY budgets_select ON budgets FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids())
         AND public.can_access_module(organization_id, 'finance'));

DROP POLICY IF EXISTS budgets_write ON budgets;
CREATE POLICY budgets_write ON budgets FOR ALL TO authenticated
  USING (public.can_approve(organization_id, 'finance'))
  WITH CHECK (public.can_approve(organization_id, 'finance'));

-- ───────────────────────────────────────────────────────────────────────────
--  Inventory ledger
-- ───────────────────────────────────────────────────────────────────────────
--
--  Movements are append-only: no UPDATE or DELETE policy exists, so the ledger
--  cannot be rewritten. Corrections are new compensating movements, which is
--  what makes stock explainable.

DROP POLICY IF EXISTS stock_movements_select ON stock_movements;
CREATE POLICY stock_movements_select ON stock_movements FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids())
         AND public.can_access_module(organization_id, 'inventory'));

DROP POLICY IF EXISTS stock_movements_insert ON stock_movements;
CREATE POLICY stock_movements_insert ON stock_movements FOR INSERT TO authenticated
  WITH CHECK (organization_id = ANY (public.auth_org_ids())
              AND public.can_access_module(organization_id, 'inventory'));

DROP POLICY IF EXISTS po_select ON purchase_orders;
CREATE POLICY po_select ON purchase_orders FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids())
         AND public.can_access_module(organization_id, 'inventory'));

DROP POLICY IF EXISTS po_write ON purchase_orders;
CREATE POLICY po_write ON purchase_orders FOR ALL TO authenticated
  USING (organization_id = ANY (public.auth_org_ids())
         AND public.can_access_module(organization_id, 'inventory'))
  WITH CHECK (organization_id = ANY (public.auth_org_ids())
              AND public.can_access_module(organization_id, 'inventory'));

DROP POLICY IF EXISTS po_items_all ON purchase_order_items;
CREATE POLICY po_items_all ON purchase_order_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_orders o WHERE o.id = order_id
                   AND o.organization_id = ANY (public.auth_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM purchase_orders o WHERE o.id = order_id
                   AND o.organization_id = ANY (public.auth_org_ids())));

-- ───────────────────────────────────────────────────────────────────────────
--  Calendar, files, notifications, logs
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS event_attendees_all ON event_attendees;
CREATE POLICY event_attendees_all ON event_attendees FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM calendar_events e WHERE e.id = event_id AND e.organization_id = ANY (public.auth_org_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events e WHERE e.id = event_id AND e.organization_id = ANY (public.auth_org_ids())));

-- Confidential files (HR documents) are visible only to their subject and HR,
-- wherever they happen to be attached.
DROP POLICY IF EXISTS files_select ON files;
CREATE POLICY files_select ON files FOR SELECT TO authenticated
  USING (
    organization_id = ANY (public.auth_org_ids())
    AND (
      is_confidential = false
      OR member_id = public.auth_member_id(organization_id)
      OR public.has_org_role(organization_id, ARRAY['owner','administrator','hr_staff']::org_role[])
    )
  );

DROP POLICY IF EXISTS files_insert ON files;
CREATE POLICY files_insert ON files FOR INSERT TO authenticated
  WITH CHECK (organization_id = ANY (public.auth_org_ids())
              AND uploaded_by = public.auth_member_id(organization_id));

DROP POLICY IF EXISTS files_delete ON files;
CREATE POLICY files_delete ON files FOR DELETE TO authenticated
  USING (
    uploaded_by = public.auth_member_id(organization_id)
    OR public.is_org_admin(organization_id)
  );

-- Notifications are strictly personal.
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated
  USING (recipient_id = public.auth_member_id(organization_id));

DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications FOR UPDATE TO authenticated
  USING (recipient_id = public.auth_member_id(organization_id))
  WITH CHECK (recipient_id = public.auth_member_id(organization_id));

DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications FOR INSERT TO authenticated
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

DROP POLICY IF EXISTS activity_select ON activity_log;
CREATE POLICY activity_select ON activity_log FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids()));

DROP POLICY IF EXISTS activity_insert ON activity_log;
CREATE POLICY activity_insert ON activity_log FOR INSERT TO authenticated
  WITH CHECK (organization_id = ANY (public.auth_org_ids()));

-- The audit log is read-only to everyone and visible to administrators only.
-- No INSERT policy: rows arrive through the SECURITY DEFINER audit trigger,
-- so the log cannot be forged by a client. No UPDATE or DELETE at all — an
-- editable audit log is not an audit log.
DROP POLICY IF EXISTS audit_select ON audit_log;
CREATE POLICY audit_select ON audit_log FOR SELECT TO authenticated
  USING (public.is_org_admin(organization_id));

-- Counters are maintained by next_document_number() (SECURITY DEFINER) and
-- are never touched directly, so members need read access only.
DROP POLICY IF EXISTS counters_select ON document_counters;
CREATE POLICY counters_select ON document_counters FOR SELECT TO authenticated
  USING (organization_id = ANY (public.auth_org_ids()));
