'use client';

import { Hexagon } from 'lucide-react';
import { PLATFORM } from '@/lib/platform';

/**
 * The platform's mark and name, in the application shell.
 *
 * ── Why this replaced `OrgMark` ───────────────────────────────────────────
 *
 * `OrgMark` rendered the *tenant's* logo and company name here. That was wrong,
 * and wrong in the way that matters for a multi-tenant product: it turned the
 * customer's branding into the product's branding, so uploading a logo in
 * Settings → Branding replaced this application's identity for that workspace.
 *
 * A tenant's logo in the sidebar means every customer sees a different product.
 * None of them bought a white-label shell, and the first time two people from
 * different workspaces compare screens neither can tell they are running the
 * same software — which also makes every support conversation start with
 * working out what the other person is even looking at.
 *
 * So this reads `PLATFORM` and nothing else. It takes no props from the store,
 * has no access to `organization`, and cannot be made tenant-dependent without
 * deleting the import — which is what makes the rule enforceable rather than
 * merely stated. `security:check` fails if anything under `components/layout`
 * reads tenant branding.
 *
 * Where the tenant's logo *does* belong is not nowhere — it is their company
 * profile, their client portal and their invoices. `WorkspaceBadge` covers the
 * one piece of tenant identity the shell legitimately shows: which workspace
 * you are currently in.
 */
export function PlatformMark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <>
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10"
        aria-hidden="true"
      >
        <Hexagon className="size-5 text-emerald-500" />
      </div>

      {!collapsed && (
        <span className="overflow-hidden whitespace-nowrap text-base font-semibold tracking-tight text-foreground">
          {PLATFORM.name}
        </span>
      )}
    </>
  );
}
