-- ═══════════════════════════════════════════════════════════════════════════
--  0021 — A tenant brands their company, not this platform
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ── What was wrong ───────────────────────────────────────────────────────
--
--  This is a multi-tenant SaaS product. The platform keeps its own name, mark
--  and favicon on every screen for every customer; a tenant's branding
--  describes *their company*, and must never replace *this product*.
--
--  Two of the three `branding` keys named platform surfaces:
--
--    show_logo_in_sidebar   the application's own navigation chrome
--    login_message          the sign-in page
--
--  That is the vocabulary of a white-label shell, and having it in the settings
--  model is what made rendering a customer's logo where this product's name
--  goes look like a completed feature rather than a category error. It was duly
--  implemented, and uploading a company logo replaced the platform's identity.
--
--  `login_message` never appeared anywhere and never could: sign-in is
--  unauthenticated, so there is no session and no way to know which workspace
--  somebody is about to enter. A per-tenant message on a page that cannot know
--  the tenant is not a feature that was missed — it is one that cannot exist.
--
--  ── What replaces them ───────────────────────────────────────────────────
--
--  The same two settings, pointed at surfaces the tenant genuinely owns — the
--  ones whose audience is *their* customer rather than this product's user:
--
--    show_logo_in_portal    their client portal, their invoices, their exports
--    portal_welcome         a greeting at the top of that portal
--
--  Values are carried across rather than reset. Somebody wrote that welcome
--  text, and the fact that it was pointed at the wrong page is this product's
--  mistake to fix, not their words to discard.
--
--  `organizations.logo_url` is untouched and keeps its meaning: it is the
--  company's logo. What changes is only where the application agrees to render
--  it.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE org_settings
SET value =
      (value - 'login_message' - 'show_logo_in_sidebar')
      || jsonb_build_object(
           'portal_welcome',
           COALESCE(value ->> 'portal_welcome', value ->> 'login_message', ''),
           'show_logo_in_portal',
           COALESCE(
             (value ->> 'show_logo_in_portal')::boolean,
             (value ->> 'show_logo_in_sidebar')::boolean,
             true
           )
         ),
    updated_at = now()
WHERE key = 'branding'
  AND (value ? 'login_message' OR value ? 'show_logo_in_sidebar');

/**
 * The seed function is *not* redefined here.
 *
 * `default_org_settings()` in 0017 holds the defaults for every policy — leave
 * types, attendance thresholds, task categories — and restating it to change
 * three branding keys would mean retyping sixty lines that must stay
 * byte-identical. The first draft of this migration did exactly that and
 * quietly altered the leave types and the overtime threshold along the way.
 *
 * Its branding block is patched in place in 0017 instead, which `db:apply`
 * re-runs before this file. The UPDATE above is what carries *existing*
 * organisations across; 0017 is what a new one is created with.
 */
