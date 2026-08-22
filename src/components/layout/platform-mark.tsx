'use client';

import { Logo, LogoMark } from '@/components/brand/logo';

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
 * So this reads `PLATFORM` and nothing else — through `components/brand/logo`,
 * which holds the drawn mark. `security:check` fails if anything under
 * `components/layout` reads tenant branding.
 *
 * Where the tenant's logo *does* belong is not nowhere — it is their company
 * profile, their client portal and their invoices. The workspace badge in the
 * header covers the one piece of tenant identity the shell legitimately
 * shows: which workspace you are currently in.
 *
 * ── Why it stopped being a lucide icon ────────────────────────────────────
 *
 * It drew `<Hexagon className="size-5 text-emerald-500" />` — a stock icon
 * from a general-purpose set, in a framework colour. `components/brand/logo`
 * exists precisely so the tab, the sign-in page, the marketing header and
 * this sidebar cannot show four different marks; this was the last screen
 * still holding its own copy.
 */
export function PlatformMark({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) return <LogoMark className="size-8 shrink-0" />;

  return (
    <Logo
      className="min-w-0 gap-2.5"
      markClassName="size-8 shrink-0"
      // 15px rather than the marketing header's size: this sits above a 13px
      // navigation list, and a wordmark that outweighs the whole column reads
      // as a logo someone was proud of rather than as a product frame.
      nameClassName="truncate text-[15px] font-semibold tracking-[-0.012em] text-foreground"
    />
  );
}
