# Design progress — Phase 1 (public + auth)

**Read this, then `DESIGN-SYSTEM.md`, then `git log --oneline -15`, before doing
anything else.**

Scope fence: public marketing surface and auth screens only. The authenticated
application (dashboard, modules, settings, onboarding, app shell) is **Phase 2
and out of bounds**. If unsure whether something is in scope, it isn't.

---

## Status

| # | Item | Status | Left to do |
|---|---|---|---|
| 0 | Stabilise — revert out-of-scope backend, fix red build | ✅ done | — |
| 1 | Design system + these three documents | ✅ done | — |
| 2 | Header · footer · mobile nav | ✅ done | — |
| 3 | Auth flows | 🔶 in-progress | **forgot-password + reset-password** still need `Field` + blur validation (they already use `AuthShell`) |
| 4 | Landing | 🔶 needs-review | Rubric pass; 360/1920 check |
| 5 | Features | 🔶 needs-review | Rubric pass |
| 6 | Pricing | 🔶 needs-review | Currency/tax line (blocked — CONTENT-NEEDED #5) |
| 7 | About | ✅ done | Team section intentionally absent (CONTENT-NEEDED #2) |
| 8 | Contact | ✅ done | Real address (blocked — CONTENT-NEEDED #1) |
| 9 | Solutions | ✅ done | — |
| 10 | Legal + utility sweep | 🔶 in-progress | Fabricated address removed + brand fixed; **visual** pass on privacy/terms/cookies still to do |
| 11 | Blog | ✅ done | Empty state; fabrications gone |
| 12 | Consistency sweep + rubric scores | ⬜ not-started | 360/768/1024/1440/1920 |

Auth screens converted: login, signup, forgot, reset, accept-invite,
change-password. **`onboarding` is the only file left carrying the old
`from-gray-50 to-gray-100` shell — it is Phase 2 app surface. Leave it.**

Still on the old design and linked from the footer: `/help`, `/docs`,
`/status`. Not in the original in-scope list; they read as a different site.

---

## Next actions, in order

Precise enough to resume cold.

### 1 · Forgot-password and reset-password → `Field` + `useFieldErrors`
Both already use `AuthShell`; they still hand-roll their field markup and
validate on submit only.

- Wrap each input in `<Field id="…">`, ids matching the `revealAll` prefix
- **reset-password's two password inputs are wrapped** for the show/hide
  button → use the **function-child form** of `Field` and spread the argument
  onto the `Input`. Passing them directly puts `aria-describedby` on the
  wrapper div, where it does nothing. This already shipped once on login and
  was caught by browser inspection, not by tsc — it will not fail the build.
- Add the `FormError` union login uses: `rateLimited` (429 — the reset mailer
  is rate-limited per recipient), `offline`, `server`
- ⚠️ **forgot-password's copy must stay non-enumerating.** It deliberately says
  "*if* that address has an account". Do not "improve" it into confirming one
  exists — the endpoint answers identically either way on purpose, and the
  screen is the last place that guarantee can be given away.

### 2 · Legal + utility visual pass
`privacy`, `terms`, `cookies` still use the old card/prose treatment. Content
is already corrected (brand, addresses). This is layout and type only — do not
touch a legal clause.

### 3 · Consistency sweep
Every in-scope page at 360 / 768 / 1024 / 1440 / 1920. Check spacing, type,
radius, button usage and voice for drift. Then publish rubric scores (§11 of
the brief), honestly, per criterion per page.

### 4 · Optional, out of the original scope
`/help`, `/docs`, `/status` are linked from the footer and still carry the old
emerald design. They read as a different site. Ask before starting.

---

## Health

Both must be green before any item is called done.

```bash
npx tsc --noEmit                  # verified: 0 errors
node scripts/security-check.mjs   # verified: "the API surface is guarded"
```

All 14 marketing + auth routes verified returning **200** on the dev server
(port 3100), including the five not yet redesigned.

`npm run build` **passes end to end**, including the standalone copy step.
Every marketing and auth route prerenders as **static (`○`)** — the payoff from
taking `'use client'` off the marketing layout, which had been pulling the
header, footer, link graph and every page inside it into the client bundle for
the sake of one `useState`.

### Verified by browser inspection, not by eye

- Mobile nav: Tab trap holds, Escape returns focus to the trigger, body scroll
  lock releases, all 7 panel links measure 44px, trigger measures 44×44
- No horizontal scroll at narrow width
- Login: no error during typing; after blur, `role="alert"` fires,
  `aria-invalid="true"`, and `aria-describedby` resolves **on the input**

---

## Decisions taken (reversible — say the word)

1. **Backend reverted.** `/api/contact`, migration `0026`, and the `proxy.ts`
   public-route entry are gone. They failed four `security:check` assertions and
   were out of scope. Spec preserved in `CONTENT-NEEDED.md` #11.
2. **NextMav stands** as the product name. `PLATFORM` in `lib/platform.ts` is
   renamed, which propagates into Phase 2 surface (sidebar, `<title>`, favicon).
   Flagged; not yet reverted.
3. **`ui/button.tsx` kept.** Three variants and one size added, no existing
   variant touched, so the 44 app importers are unaffected.
4. **Brief beats skill** on visual and content recommendations. The
   `ui-ux-pro-max` database recommends glassmorphism, trust-blue, logo carousels
   and stat counters for SaaS — precisely the tells the brief bans. The skill
   governs accessibility, motion, forms, navigation and performance, where the
   two agree.
5. **No dead OTP route.** Deferred; see `CONTENT-NEEDED.md` #12.
6. **Fabrications deleted, not placeheld in-page.** Listed in
   `CONTENT-NEEDED.md` instead.

---

## Environment notes

- The skill is cloned to `.claude/skills/ui-ux-pro-max-skill` and is
  **gitignored** (`.gitignore:46`).
- **Its `search.py` cannot run — Python is not installed** on this machine
  (`python`/`python3` are Windows Store alias stubs, exit 49). The CSV databases
  and `references/*.md` are being read directly instead. Ranking is unavailable;
  content is not.
- The clone ships its own `CLAUDE.md`, which auto-loads into context and
  describes *that repo's* workflow. It does not apply to NextMav.
- Dev server: `.claude/launch.json` → port **3100**.

---

## Open questions

Asked, not yet answered — proceeding on the recommendation in each case, all
reversible:

1. Confirm the backend revert (taken).
2. Confirm NextMav over NexusCorp, and whether the `PLATFORM` rename should wait
   for Phase 2 given it touches the app shell.
3. Confirm brief-beats-skill on visual/content.
4. OTP + email verification — deferred; confirm.
5. Fabricated content — deleted; confirm.
6. Install Python for the skill's search tool?
7. Annual pricing for the billing toggle.
8. Is `/blog` in Phase 1 scope? Currently treated as credibility-fix only.
