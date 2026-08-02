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
| 2 | Header · footer · mobile nav | 🔶 in-progress | Logged-in header state; 360px pass |
| 3 | Auth flows | 🔶 in-progress | Blur validation on login/signup; rate-limited + offline states |
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

## Health

Both must be green before any item is called done.

```bash
npx tsc --noEmit          # currently: 0 errors
node scripts/security-check.mjs   # currently: passing
```

`npm run build` has not been run end-to-end this session — do it before the
final sweep.

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
