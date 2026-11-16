# Application experience — October 22 refinement

## Audit and direction

The authenticated `/dashboard` shell mounts modules lazily and uses the existing
Zustand store for selection, capability filtering, notifications and record focus.
The previous large dark readout and long serial dashboard sections buried urgent
work. Flat navigation gave every module equal weight. Chart tokens were sampled
from the document root even though application overrides live on the body.

Preserve the typed registry, server capability filtering, Radix keyboard/focus
handling, record-aware navigation, real calculations, and each module's local tabs.
The supplied banking reference informs compact proportions, white surfaces,
restrained accents and a balanced analytics grid; its figures and branding are
not reused.

## Implemented foundation

- White navigation and cards on #F7F8FA, charcoal text and #365CF5 actions.
- 68px category rail plus contextual panel (284px total). Overview offers all
  permitted modules; other categories show their existing modules. Collapsing
  retains category access, search, account and settings. Tooltips label icons.
- Workspace identity, compact breadcrumb toolbar, existing search/notifications.
- Reusable presentation-only KpiCard, compact overview heading, balanced analytics
  and attention columns, project health, receivables, operational panels and activity.
- Honest empty states, existing chart series and refreshed loading skeleton.
- Shared scoped styling for tables, tabs, forms, buttons, menus, dialogs and empty
  states. Chart token sampling now reads the authenticated application element.
- Mobile sheet with 44px module targets; two-column mobile KPIs; attention promoted
  above analytics on smaller screens; reduced motion and visible keyboard focus.
- Dark appearance remains supported with explicit contrasting tokens.

All application overrides are scoped through `body:has(.nm-app)` and `.nm-app`,
including portalled surfaces. Marketing and authentication routes retain their
existing styles. No dependencies were added.

## Deliberately retained boundaries

No new module routes, mocked metrics, backend workflows, schemas, RLS, API or store
changes. No invented Business API module or workspace-switching control. Sales
continues inside CRM. Local module tabs remain inside modules: moving those tabs
into global navigation would require a separate state-contract change.

Detailed module redesigns remain subsequent work. This pass gives them consistent
surfaces and controls. Existing working responsive CRM record cards are retained.

## Verification

Passed TypeScript, targeted ESLint, production compilation, navigation tests,
dashboard attention tests, layout tests and security checks. Production compilation
used NEXT_DIST_DIR=.next-build to avoid interfering with the live dev server;
the existing packaging helper still copies from .next and was not changed.

Inspected the signed-in owner workspace at desktop, tablet and mobile dimensions,
including real sparse dashboard data, CRM records and HR charts. Verified category
navigation, collapse/expand, mobile navigation and automatic sheet dismissal.
Role visibility is covered by the existing role matrix tests; other live role
accounts and state-changing business transactions were not exercised.

292 tracked marketing/backend/store/database files were hash-compared with the
start-of-pass baseline and were unchanged. Existing uncommitted work was retained.
Full repository lint results are in .design-review/oct22/lint.log; unrelated
pre-existing tooling/test errors are separate from the passing targeted lint.

## October 24 focused refinement

Executive Overview and My Work now have separate explicit groups; neither expands
all modules. Communication has its own Collaboration group. Categories remember
the last selected permitted module within the mounted shell. Contextual width is
300px, with more readable row spacing.

Existing CRM, Projects, HR and Finance controls render through ContextualNavigation
into the desktop sidebar. React portals preserve the module-owned callbacks,
permissions and context. Collapsed and mobile layouts render the same controls
back inside the module, without maintaining a second copy of their state.

Search grouping and keyboard-selected result presentation were refined. Executive
Overview adds organization/update context and refined chart-container hierarchy.
All existing metrics and series are retained; no fabricated history was introduced.

Navigation (44), dashboard (21), and layout (118) tests passed. Targeted lint and
TypeScript passed. Live signed-in inspection confirmed CRM and Projects section
controls in the sidebar and the updated dashboard. Full transaction workflows and
other live roles were not exercised. Earlier full-repository lint failures remain
outside this refinement's scope.

## Horizontal contextual navigation refinement

The shared ContextualNavigation now renders existing controls in place above module
content at every viewport width. It no longer portals them into the sidebar.
The primary sidebar, navigation registry, module implementations, permissions and
state management were not edited in this pass. CRM, Projects, HR and Finance use
the shared wrapper; single-page modules gain no extra navigation.

Overflow uses a horizontal scrollbar and conditional directional buttons. Keyboard
focus reveals offscreen destinations, active indicators use the application accent,
and reduced motion is respected. Existing exports/actions stay beside the row.

Verified signed-in CRM overflow and Activities selection, Projects Tasks selection,
HR's long section row, and Finance Invoices selection across desktop/mobile sizing.
Finance's mobile page width matches its viewport. Navigation (44) and layout (118)
tests passed. Targeted ESLint passed. Standard type-checking encountered malformed
generated .next/dev route declarations; an isolated check also found existing
incomplete dashboard test fixtures. Production compilation succeeded; full build
verification did not complete. These limitations are not reported as passing checks.
