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
| 3 | Auth flows | 🔶 in-progress | **Login done.** Signup, forgot, reset, accept-invite, change-password still to convert |
| 4 | Landing | 🔶 needs-review | Rubric pass; 360/1920 check |
| 5 | Features | 🔶 needs-review | Rubric pass |
| 6 | Pricing | 🔶 needs-review | Currency/tax line (blocked — CONTENT-NEEDED #5) |
| 7 | About | ⬜ not-started | Full rebuild; fabricated content to strip |
| 8 | Contact | ✅ done | Real address (blocked — CONTENT-NEEDED #1) |
| 9 | Solutions | ✅ done | — |
| 10 | Legal + utility visual sweep | ⬜ not-started | privacy, terms, cookies, 404, error |
| 11 | Blog credibility fix | ⬜ not-started | Strip fabrications, kill dead links |
| 12 | Consistency sweep + rubric scores | ⬜ not-started | 360/768/1024/1440/1920 |

Also untouched and still on the old design, linked from the footer:
`/help`, `/docs`, `/status`, `/accept-invite`, `/change-password`.

---

## Next actions, in order

Precise enough to resume cold.

### 3a. Signup — convert to `Field` + `useFieldErrors`
`src/app/signup/page.tsx`. Five fields: `firstName`, `lastName`, `email`,
`password`, `organization`. Currently uses bare `<div className="space-y-2">`
with `<Label>` and relies on `required` plus a toast.

- Wrap each in `<Field id="signup-…">`; ids must match the `revealAll` prefix
- The password field **wraps its input** for the show/hide button → use the
  **function-child form** of `Field` (see the note in `forms/field.tsx`)
- Its existing `aria-describedby="password-requirements"` is already correct
  and must be preserved — `Field` yields to a caller-set value
- Replace `toast.error` with the same `FormError` union login now uses:
  `rateLimited` (429 — signup is rate-limited hourly per address), `offline`,
  `server` (5xx), plus a `duplicate` case for an address already registered
- Keep the spinner up through `window.location.assign`, as login does

### 3b. Forgot / reset password
Same conversion. `forgot-password` already has correct non-enumerating copy —
do not "improve" it into confirming that an account exists.

### 3c. Accept-invite + change-password
Still on the old centred-card gradient. Move both to `AuthShell`. These are the
last two files carrying the `from-gray-50 to-gray-100` treatment.

### 7. About — the largest remaining job
Strip six fabricated executives, the invented founding date and four invented
metrics (`CONTENT-NEEDED.md` #2), then rebuild around whatever is real.

### 11. Blog
Eight fabricated posts, all `href="#"`, one contradicting About on who is CEO.
Minimum: remove the fabrications and the dead "Load more".

### 12. Final sweep
`npm run build` end to end, then all pages at 360 / 768 / 1024 / 1440 / 1920,
then publish rubric scores.

---

## Health

Both must be green before any item is called done.

```bash
npx tsc --noEmit                  # verified: 0 errors
node scripts/security-check.mjs   # verified: "the API surface is guarded"
```

All 14 marketing + auth routes verified returning **200** on the dev server
(port 3100), including the five not yet redesigned.

`npm run build` has **not** been run end-to-end this session — do it before the
final sweep.

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
