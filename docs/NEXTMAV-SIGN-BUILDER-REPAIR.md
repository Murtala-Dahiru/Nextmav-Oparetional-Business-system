# NextMav Sign builder verification

## Scope and status

The shared Quick Send / Advanced Send editor has been repaired and exercised in Microsoft Edge against the running production application and the existing acceptance tenant. Database migrations were not required. Field definitions remain in the existing agreement JSON aggregate. Test documents were created only in existing acceptance accounts. No invitation emails were sent.

## Reproduced defects and root causes

- Witness Signature activated but placed nothing while a signer was selected, even when a witness existed. Placement required a manually preselected witness. Witness Name and Witness Date also used inconsistent labels.
- Toolbar drag created no field. The library lacked a drag/drop interaction.
- Advanced Send had no editor history. Quick Send maintained a separate undo-only stack.
- Clicking existing overlays intercepted placement. Blank-page clicks did not clear selection.
- Resize arithmetic could produce dimensions infinitesimally below the server minimum.
- Save accepted structurally valid fields without checking recipient/page associations until issue.
- Rotated PDFs were rejected because final rendering assumed unrotated page coordinates.
- The stylesheet compiler timed out while scanning the workspace. Tailwind now scans the application source.

## Implemented behavior

- Every individual tool supports click placement and pointer drag placement. Witness tools resolve an eligible witness and are disabled with guidance when none exists.
- Selected fields have four corner handles. Movement and resize clamp to page boundaries. Shift-resize preserves proportions. Touch movement uses pointer capture.
- Undo, redo, copy, paste, duplicate, delete, Escape and small/large arrow nudges are shared by both editors. Each move/resize produces one history action. Input typing retains native shortcuts.
- Optional field groups create independently editable fields. No mandatory accompanying fields are added by individual tools.
- Selected properties include recipient, required status, type, label, page, position, dimensions, supported fonts, font size, alignment, defaults, placeholders and applicable validation.
- Optional 1% grid, peer alignment guides, page alignment controls and document-text suggestions are available. Suggestions require explicit acceptance.
- Preview filters by recipient. The toolbar shows selection/placement mode, history availability and collapsible panels.
- Explicit save, dirty indicators, save failure retention and retry, reload persistence and browser unload warning are implemented.
- Template rename joins existing duplicate, reuse/edit, versioned save and archive operations.
- Completed PDF rendering handles 0/90/180/270-degree page rotation. Font validation and rendering use the selected font.
- Save validates field ownership, page membership and signature/date relationships. Existing issue/completion guards remain active.

## Verification

- Production build passed, including TypeScript, all 189 static pages and standalone packaging.
- Focused ESLint passed.
- Editor unit suite passes 21 tests covering all tools/groups, boundaries, assignment, history branching and proportional resize.
- Existing signing, finishing and customization suites passed. Shared navigation and stage-layout regressions passed.
- Real Edge component tests passed individual tools, witness assignment, optional groups/suggestions, second-page drag, resize, history, copy/paste, property editing, alignment, zoom, mobile tap and touch movement.
- Full production browser suite passed 52 assertions before the additional save-failure scenario. It covered six editor-placed customer/witness fields, save/reopen, preview, separate secure sessions, typed/drawn/uploaded signatures, finalization and evidence verification.
- Quick Send passed 21 browser assertions including drag, resize, undo, zoom, secure link completion and evidence verification.
- Live customization suite passed 20 assertions including sequential witness order, foreign-field rejection, authoritative signing dates, immutable issued documents and template isolation.
- Cross-tenant API and RLS tests passed with two separate acceptance accounts. Template clone/rename/archive and Commercial Hub source-version binding passed.
- Completed PDF raster comparisons passed for unrotated and rotated pages. New ink stayed inside saved fields. A dense four-page fixture passed at 0, 90, 180 and 270 degrees with all three fonts.
- The sequential completed PDF was rendered and visually reviewed. Customer/witness marks, names and dates were legible, with no editor outlines.
- The repository-wide static security checker reports the same four findings recorded before this task. Its portal authentication assumptions, privileged route patterns and server-only RLS tables require policy reconciliation. Its failure is not counted as a passing security gate.

## Files changed in this task

- src/components/sign/field-editor.tsx
- src/components/sign/pdf-viewer.tsx
- src/components/sign/quick-send.tsx
- src/components/sign/workspace.tsx
- src/lib/sign/editor.ts
- src/lib/sign/model.ts
- src/lib/sign/server.ts
- src/app/api/sign/[id]/route.ts
- src/app/api/sign/templates/route.ts
- src/app/globals.css
- scripts/sign-editor.test.mts
- scripts/sign-editor-browser.mjs
- scripts/sign-editor-integrations.mjs
- scripts/sign-editor-pdf.mjs
- scripts/sign-customization-regression-browser.mjs
- scripts/sign.test.mts

Next also added the isolated verification output paths to the existing tsconfig.json. The repository already contained substantial uncommitted work, including all Sign files, before this task.

## Supported limits and remaining work

- Explicit save is the persistence model. Unsaved changes are retained after a failed save within the open editor. Crash recovery and cross-tab draft merging are not implemented.
- History covers field edits within the current recipient configuration. Changing the recipient roster resets field history to avoid restoring deleted owners.
- Suggestions inspect extractable PDF text. Scanned-document OCR is not implemented.
- Conditional visibility, arbitrary fonts, cross-device clipboard and multi-field distribution are not implemented or advertised.
- Serif and monospace use PDF standard fonts. Characters outside their supported encoding are rejected. Liberation Sans retains the broader character support.
- Cropped/offset page boxes, encrypted documents, active content and existing interactive forms still require a static export.
- Mobile checks use Edge touch emulation. Safari, Firefox, physical devices, screen-reader certification, WCAG conformance, jurisdictional compliance and international certification have not been verified.
- Commercial source binding and existing Quick Send were exercised. Full CRM-wide certification and provider-dependent email delivery remain outside this verification.
- A later extended browser run encountered an authenticated sender session expiry after reload. The test was restarted with a fresh login. Results of the final rerun are recorded below.
## Additional security results

The extended signing security suite passed 18 assertions on this task's production build. It covered provider-policy enforcement, expired access, link rotation, recipient correction, cross-origin rejection, premature completion rejection, Unicode completion, identity immutability, replay, terminal decline/change requests, template reuse/archive and private storage. The suite intentionally queued a finalization recovery in the acceptance tenant. The tenant-scoped maintenance worker completed one document, expired two acceptance documents and reported zero failures.
## Final browser rerun

The fresh-login production run passed all 53 assertions, including the injected save failure and retry, reopening the saved agreement, witness preview, both editor-prepared signing sessions, raster placement checks, and the typed/drawn/uploaded parallel signing flow. It reported zero uncaught browser errors. The earlier sender-session interruption remains recorded above.

The final component run also passed Shift-resize aspect-ratio preservation and an emulated touch drag. The final unit run passed all 24 Node test entries, including the three existing Sign suites and 21 editor tests. Focused ESLint passed.

## Release assessment

Implemented and verified within the tested environment: field editing, witness assignment, history, pointer interactions, supported customization, optional suggestions/groups, saved-draft recovery, recipient completion, rotated PDF rendering, template operations and the scoped security regressions described above.

Implemented with limited verification: mobile/touch behavior was tested through Edge emulation. Suggestion quality is limited to explicit text labels. Fullscreen availability/error handling is implemented, but OS-level fullscreen behavior was not separately certified.

Not implemented: OCR, conditional visibility, cross-tab merge, crash recovery of unsaved edits, multi-field distribution and international/accessibility certification.

The static security gate still has four pre-existing findings. Production certification and a universal “global standards” claim are not established by this work. The repository is ready for controlled acceptance of the verified builder flows, with those release limitations visible.

Final packaging build exited successfully after the proportional-resize change. Compilation, TypeScript, static generation and standalone asset preparation passed. The final standalone server starts successfully at http://localhost:3018/dashboard. The latest source component browser test verified proportional resize before packaging. The 53-assertion full workflow run preceded that final resize-only change.

## Follow-up — unnamed recipient validation, 13 November 2026

The reported recipients[2].name error came from applying the issue-ready recipient schema to draft saves and returning raw Zod errors. Draft saves now retain blank recipient names, including a zero-recipient draft. Enabling signing still requires completed recipient identities. The editor checks before sending, opens Recipients, focuses the invalid name and displays a numbered, actionable message. The API independently enforces the same issue validation and formats validation errors for the sender.

Verified against the running development app on port 3000 using a new acceptance agreement with three recipients. Five browser assertions passed, including save with an unnamed third recipient, focused guidance, direct API rejection and successful issue after correction. The 22-test editor suite and focused ESLint passed. No customer agreement was modified by the test.
