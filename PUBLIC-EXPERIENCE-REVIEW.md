# NextMav public experience refinement

Review date: 12 October 2026

## Boundary and implementation

The repository uses Next.js 16.1.3, React 19, TypeScript, Tailwind and shadcn/ui.
Marketing is in `src/app/(marketing)`. Account screens are separate routes using
`components/auth/auth-shell.tsx`. Marketing and account styling is isolated by
the `.nm-public` wrapper, rather than relying on route-level CSS imports alone.

The existing public logo, emerald palette, warm neutrals, Plus Jakarta Sans,
Instrument Serif accents and JetBrains Mono labels were retained. The new
`premium.css` layer defines public-only surface, radius, shadow and section
tokens, strengthens focus states and contrast, reduces decorative effects,
and introduces responsive editorial layouts. No application dependency was added.

The assessment below is based on source review. Browser inspection was attempted,
but a saved localhost permission setting blocked it even after the user approved
browser testing. No visual quality or browser interaction result is claimed.

| Area | Decision | Result |
| --- | --- | --- |
| Brand, typography and public isolation | Keep & polish | Existing identity retained; public-only refinement layer added. |
| Navigation and footer | Improve | Product/resources navigation, a keyboard-reachable mobile close control, four footer groups and repaired security anchor. Unimplemented newsletter removed. |
| Homepage hero | Improve | Clearer connected-work positioning; inherited typography and composition retained. |
| Homepage product mock and decorative metrics | Redesign | Existing dashboard structure shown as an explicitly labelled schematic, without invented financial or operational figures. |
| Homepage capability layout, company principles and security | Keep & polish | Strongest section structures retained; controlled surfaces and truthful supporting content. |
| Industry storytelling and growth direction | Add | Editorial industry rows, connected-work sequence, explicit current/planned boundaries. |
| Product `/features` | Improve | Existing capability status map retained; working capability anchors, connected-work narrative and dashboard guide added. |
| Solutions | Improve | Existing role perspectives retained; five industry pages use a shared data-driven template. |
| Pricing | Redesign | Existing $29/$79 amounts preserved as provisional. Removed unsupported entitlements, service promises and popularity claims. No invented billing toggle. |
| About | Keep & polish | Existing story and mission composition retained; Africa/global ambition added without invented company facts. |
| Contact | Improve | Existing validation retained. Sending requires a deployment-configured verified mailbox. Unconfigured state is explicit. |
| Documentation, help, blog and status | Keep & polish | Shared reading hierarchy and honest empty states; unverified support mail links route to contact-channel availability. No fabricated posts or live status. |
| Privacy, terms and cookies | Keep & polish | Reading typography improved through scoped CSS. Legal wording and dates unchanged. |
| Login, signup, recovery, verification and invitations | Keep & polish | Shared auth shell refined, policy links added, existing field validation and password controls retained. Signup trial claim removed. |
| Onboarding | Redesign presentation | Shared auth kit, meaningful two-step indicator, persistent inline errors. Existing workspace creation contract retained. |

## Routes covered

`/`, `/features`, `/solutions`, `/pricing`, `/about`, `/contact`, `/docs`, `/help`,
`/blog`, `/status`, `/privacy`, `/terms`, `/cookies`, `/login`, `/signup`,
`/forgot-password`, `/reset-password`, `/verify`, `/accept-invite`,
`/change-password`, `/onboarding`.

New industry routes: `/solutions/agencies`, `/solutions/consulting`,
`/solutions/technology`, `/solutions/construction`, `/solutions/other-businesses`.
Consulting includes professional services. Unknown industry slugs return 404.

## Auth and onboarding contracts

Login/signup/recovery/invitation request handlers, Supabase clients, proxy/session
policy and authorization logic were not changed. Existing safe login redirects,
email verification, password rules, invitation tokens and full-document navigation
remain in place.

Onboarding still reads `/api/auth/session`, posts only `{ name }` to
`/api/organizations`, and navigates to `/dashboard` after successful creation.
Existing blocked-account and invitation handling are retained. Error presentation
changes from transient toasts to persistent inline notices. No industry field,
configuration engine, database migration or provisioned module selection was added.

## Verification

- `npx tsc --noEmit --incremental false`: passed.
- `npx eslint src scripts --no-warn-ignored`: passed with five existing warnings.
- Unfiltered `npm run lint`: interrupted because it traverses generated `.next-preview` bundles.
- `npm run lint -- --ignore-pattern '.next*/**'`: failed on 33 existing errors in bundled `.claude` skill/example files, with five source warnings. No rules were weakened and those files were not modified.
- `npm run lint -- --ignore-pattern '.next*/**' --ignore-pattern '.claude/**'`: passed with five existing warnings.
- `npm test`: 30 passed.
- `npm run test:dashboard`: 21 passed.
- `npm run test:navigation`: 44 passed.
- `npm run test:layout`: passed. This exercises the existing business meeting layout, not public viewport rendering.
- `npm run security:check`: passed.
- `node scripts/public-experience-check.mjs`: passed: 24 public/auth HTTP responses, 689 internal link occurrences and anchor targets, login/signup/recovery navigation, three protected-route login guards, local logo, and CSS selector isolation.
- `git diff --check`: passed.
- Final `npm run build`: passed after the last source/CSS refinement, including TypeScript, static generation and standalone packaging. Marketing pages prerendered and all five industry pages statically generated.

HTTP checks do not prove keyboard behavior, viewport layout or successful signed-in
flows. Browser QA, real email delivery, accepting a valid invitation, password
recovery completion and authenticated organization creation were not exercised.
No real users or organization data were created or changed during verification.

## Files modified or added by this work

- `src/app/(marketing)/layout.tsx`
- `src/app/(marketing)/page.tsx`
- `src/app/(marketing)/features/page.tsx`
- `src/app/(marketing)/solutions/page.tsx`
- `src/app/(marketing)/solutions/[industry]/page.tsx` (new)
- `src/app/(marketing)/pricing/page.tsx`
- `src/app/(marketing)/about/page.tsx`
- `src/app/(marketing)/contact/page.tsx`
- `src/app/(marketing)/docs/page.tsx`
- `src/app/(marketing)/help/page.tsx`
- `src/app/(marketing)/blog/page.tsx`
- `src/app/(marketing)/status/page.tsx`
- `src/app/signup/page.tsx`
- `src/app/onboarding/page.tsx`
- `src/components/public/header.tsx`
- `src/components/public/footer.tsx`
- `src/components/auth/auth-shell.tsx`
- `src/components/marketing/industry-data.ts` (new)
- `src/components/marketing/industry-section.tsx` (new)
- `src/components/marketing/connected-work.tsx` (new)
- `src/components/marketing/product-preview.tsx` (new)
- `src/styles/public/premium.css` (new)
- `scripts/public-experience-check.mjs` (new)
- `PUBLIC-EXPERIENCE-REVIEW.md` (new)

Other account and legal pages inherit shared styling without direct file edits.

## Remaining configuration and review

1. Configure `NEXT_PUBLIC_CONTACT_EMAIL` with a verified mailbox and restart/rebuild
   to enable the email-draft path. It opens the visitor's email app; it is not a
   server submission or a delivery receipt. No supplied address was verified.
2. Confirm commercial pricing, currency, taxes, limits and service terms before
   publishing paid plans. Existing figures remain explicitly provisional.
3. Resolve the saved browser permission setting for localhost, then visually
   review desktop/tablet/mobile layouts and exercise keyboard and form states.
4. Use authorized test accounts for end-to-end auth, invitation, recovery and
   organization creation tests.
5. Existing legal entity details, dates and mailboxes require the owner's review.
   Their wording was preserved as requested.
6. The preview is a schematic, not a captured product screenshot. A real product
   screenshot should come from an authorized test workspace after browser access
   is restored. Existing editorial photos remain in the kept sections.

## Authenticated platform

No changes were made to dashboard routes, internal modules, application layout,
state stores, business APIs, schemas, migrations, RLS, permissions, root layout or
global application styles. `src/components/modules/hr/ui.tsx` was already modified
when this task began; that pre-existing user change was left untouched.
