-- ═══════════════════════════════════════════════════════════════════════════
--  0006 — Storage buckets and Realtime
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  Buckets
-- ───────────────────────────────────────────────────────────────────────────
--
--  PATH CONVENTION — the whole storage security model rests on it:
--
--      {organization_id}/{rest-of-path}
--
--  Every policy checks that the first path segment is an organization the
--  caller belongs to. Uploading outside your own organization's prefix is
--  therefore impossible, and one rule covers every bucket. Application code
--  must build paths accordingly; a file written to a flat path is
--  unreachable by design rather than leaked.
--
--  `avatars` and `logos` are public: they are rendered in <img> tags all over
--  the product, and signing every avatar URL is a per-request round trip for
--  no benefit. Everything else is private and served through signed URLs.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars',   'avatars',   true,   5 * 1024 * 1024,
     ARRAY['image/jpeg','image/png','image/webp','image/gif']),
  ('logos',     'logos',     true,   5 * 1024 * 1024,
     ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']),
  ('documents', 'documents', false, 50 * 1024 * 1024, NULL),
  ('attachments','attachments', false, 25 * 1024 * 1024, NULL),
  -- HR files are separated from general documents so "only HR and the subject
  -- may read this" is a bucket-level rule rather than a per-object check that
  -- someone will eventually forget.
  ('hr-documents','hr-documents', false, 25 * 1024 * 1024, NULL),
  ('receipts',  'receipts',  false, 10 * 1024 * 1024,
     ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public             = EXCLUDED.public;

/**
 * The organization that owns an object, taken from the first path segment.
 *
 * Returns NULL when the leading segment is not a uuid, which makes a
 * malformed path fail closed rather than matching something unexpected.
 */
CREATE OR REPLACE FUNCTION public.storage_org_id(object_name text)
RETURNS uuid
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  head text;
BEGIN
  head := split_part(object_name, '/', 1);
  RETURN head::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.storage_org_id(text) TO authenticated, anon;

-- ── Object policies ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "org members read own files"   ON storage.objects;
DROP POLICY IF EXISTS "org members upload own files" ON storage.objects;
DROP POLICY IF EXISTS "org members update own files" ON storage.objects;
DROP POLICY IF EXISTS "org members delete own files" ON storage.objects;
DROP POLICY IF EXISTS "public read avatars and logos" ON storage.objects;

-- Public buckets: anyone may read, including signed-out visitors rendering a
-- company logo on a public page.
CREATE POLICY "public read avatars and logos" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id IN ('avatars','logos'));

CREATE POLICY "org members read own files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('documents','attachments','receipts','hr-documents')
    AND public.storage_org_id(name) = ANY (public.auth_org_ids())
    AND (
      -- HR documents are restricted further: the subject and HR only. The
      -- subject's own membership id is the second path segment.
      bucket_id <> 'hr-documents'
      OR public.has_org_role(public.storage_org_id(name),
                             ARRAY['owner','administrator','hr_staff']::org_role[])
      OR split_part(name, '/', 2) = public.auth_member_id(public.storage_org_id(name))::text
    )
  );

CREATE POLICY "org members upload own files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.storage_org_id(name) = ANY (public.auth_org_ids())
    AND (
      bucket_id <> 'hr-documents'
      OR public.has_org_role(public.storage_org_id(name),
                             ARRAY['owner','administrator','hr_staff']::org_role[])
    )
  );

CREATE POLICY "org members update own files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (public.storage_org_id(name) = ANY (public.auth_org_ids()))
  WITH CHECK (public.storage_org_id(name) = ANY (public.auth_org_ids()));

CREATE POLICY "org members delete own files" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    public.storage_org_id(name) = ANY (public.auth_org_ids())
    AND (
      owner = auth.uid()
      OR public.is_org_admin(public.storage_org_id(name))
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
--  Realtime
-- ───────────────────────────────────────────────────────────────────────────
--
--  Realtime respects RLS: a subscriber receives a change only if they could
--  have SELECTed the row. The policies in 0005 therefore govern subscriptions
--  too, and no separate rules are needed.
--
--  Only tables where a live update genuinely changes what someone is looking
--  at are published. Adding every table would mean every write fans out to
--  every connected client and is then discarded by RLS — cost with no benefit.
--
--  REPLICA IDENTITY FULL makes the old row available on UPDATE and DELETE,
--  which subscribers need to reconcile local state; without it a delete
--  arrives carrying only the primary key.

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'messages',            -- chat
    'message_reactions',
    'notifications',       -- notification bell
    'tasks',               -- board and task updates
    'projects',
    'attendance_records',  -- who is in today
    'activity_log',        -- team activity feed
    'comments',
    'support_tickets'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
      -- Adding a table twice is an error, so check membership first.
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
--  Presence
-- ───────────────────────────────────────────────────────────────────────────

/**
 * Heartbeat for "who is online".
 *
 * A function rather than a direct UPDATE so the client cannot write anyone
 * else's presence, and so the write stays cheap enough to call on an interval.
 */
CREATE OR REPLACE FUNCTION public.touch_presence()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE profiles SET last_seen_at = now() WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.touch_presence() TO authenticated;

/** Members seen within the last five minutes. */
CREATE OR REPLACE FUNCTION public.online_members(org uuid)
RETURNS TABLE (member_id uuid, user_id uuid, full_name text, avatar_url text, last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT om.id, p.id, p.full_name, p.avatar_url, p.last_seen_at
  FROM organization_members om
  JOIN profiles p ON p.id = om.user_id
  WHERE om.organization_id = org
    AND om.is_active = true
    AND p.last_seen_at > now() - interval '5 minutes'
    -- Only disclose presence to someone inside the organization.
    AND public.is_org_member(org);
$$;

GRANT EXECUTE ON FUNCTION public.online_members(uuid) TO authenticated;
