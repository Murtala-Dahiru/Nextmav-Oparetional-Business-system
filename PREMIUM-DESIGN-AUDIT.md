# NextMav public experience audit

## Observed before implementation

Browser review at 1440 × 1000 and 390 × 844, 13 October 2026. Inspected home, product, solutions, pricing, about, contact, resources, legal and accessible account states. Industry routes share the same composition. Dashboard and onboarding redirect to login without a session; no guard was bypassed. Legacy screenshots have old branding and unverified provenance and will not be published.

**Preserve:** green brand and logo; honest capability status catalogue; industry taxonomy; pricing figures and provisional status; contact validation and mail-draft contract; account forms and authentication contracts; readable legal content.

**Refine:** navigation alignment and mobile menu; footer hierarchy; form density and borders; pricing comparison; supporting-page typography; industry capability links.

**Transform:** repetitive hero copy; text-only product schematic; thirteen-section homepage with overlapping messages; identical oversized page introductions; repeated floating cards and italic headlines; animation-dependent content visibility.

## Direction and priorities

1. Flagship home: concise business proposition, wide product demonstration, capability index, connected-work story, industry paths, concrete trust foundations and a clear next step.
2. Product demonstrations: isolated public components, real module fields and vocabulary, explicitly illustrative records, no financial metrics or private data. These are representations, not screenshots or live application controls.
3. Visual system: forest green and warm paper, strong sans-serif headings, serif used sparingly, 1200px content measure, 8px spacing rhythm, crisp borders, restrained corners, no decorative glow. Content must render visible without animation.
4. Page-specific composition: product showcase, editorial company page, compact pricing, purposeful industry workflow panels, practical contact layout.
5. Verify route rendering, links, keyboard interactions, mobile overflow, account guard preservation, TypeScript and production build. Record limitations honestly.

## Scope boundary

Only public pages/components/styles. No changes to dashboard, business modules, API routes, schemas, permissions or authentication logic. Existing unrelated HR edit preserved. Baseline diff saved locally in `.design-review/baseline.patch`.

## Completed refinement

- Recomposed homepage around a forest-green hero, wide interactive product representation, compact capability index, connected workflow, industry paths and clear conversion section. Preserved the existing green brand instead of introducing an unrelated blue identity.
- Added isolated public typography, spacing, surface and responsive rules in `editorial.css`. Removed animation-dependent visibility and repetitive card treatments.
- Refined product, pricing, About, Contact, resources, navigation, footer and shared authentication presentation. Preserved pricing figures, provisional plan status and account contracts.
- Added industry-specific operational briefs and locally optimized licensed photography for agencies, consulting, technology and construction. Sources and license are recorded in `public/images/industries/CREDITS.md`.
- Product explorer now covers twelve module views in four categories, with a mobile selector and explicitly identified sample records. It is a composed representation, not an actual application screenshot. Mobile tables retain project/customer context beneath the record name, and explanatory text and capability links have larger text and touch targets.

## Verification and remaining dependencies

- TypeScript: `npx tsc --noEmit` passed.
- Targeted ESLint covering marketing, public navigation, authentication shell, signup and onboarding: passed.
- Public regression check: 24 routes, 810 internal links, authentication navigation, local logo, public CSS isolation and three protected-route redirects passed on 14 October 2026.
- Browser responsive checks: all 24 accessible routes at 390 × 844 and 1440 × 1000 without horizontal overflow. Reviewed representative full-page compositions. Product tour switching, mobile menu/Escape, password visibility and empty-login validation checked.
- Production compilation verified on 14 October 2026: `NEXT_DIST_DIR=.next-build npx next build --webpack` completed successfully, including TypeScript, 150 generated pages and build tracing. Font-download TLS retries recovered. Environment preflight also passed. Build output was isolated from the running preview; the standalone packaging script was not run.
- Follow-up TypeScript passed after regenerating stale generated route types with `next typegen`. Targeted ESLint passed. `npx tsx scripts/public-product-tour.test.tsx` passed all twelve previews, capability destinations, mobile choices and unique accessibility IDs. Browser switching across all twelve mobile previews showed no horizontal overflow; mobile menu Escape restored focus to its trigger.
- Authenticated onboarding and successful verification/invitation lifecycles still require an authorized test session/token. No authentication guard was bypassed and no account was created.
- Authentic product screenshots require an authorized demo session. Legacy screenshots with unverified provenance were not published.
- Contact email remains unconfigured. The form clearly reports that the contact channel is unavailable; no mailbox was invented and no false success state was introduced.
- The pre-existing HR edit remains byte-for-byte unchanged (SHA-256 `245217B179FA9DA81245ACE48687C8315B5DEB2BF776AE2F67D56F0E4430CFF0`). No dashboard, business API, schema, permission or internal module changes were made in this refinement.
