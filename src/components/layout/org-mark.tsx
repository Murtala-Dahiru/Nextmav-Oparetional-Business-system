'use client';

import Image from 'next/image';
import { Hexagon } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

/**
 * The organisation's mark and name.
 *
 * ── What was here before ──────────────────────────────────────────────────
 *
 * A generic hexagon and the literal string "NexusCorp", in two places — the
 * desktop sidebar and the mobile one. Meanwhile `organizations.logo_url` has a
 * column and an upload control on the settings screen, `organizations.name` is
 * what every workspace is actually called, and `branding.primary_colour` has a
 * default, a validator and a colour picker behind it.
 *
 * So a company could set all three and see their own name nowhere in the
 * product they had just configured. That is the same "stored but never read"
 * shape as the leave policy and the project defaults, and it is the most
 * visible instance of it: it is the first thing on the screen.
 *
 * ── Why the fallbacks are what they are ───────────────────────────────────
 *
 * The hexagon stays as the fallback rather than being replaced by initials. A
 * workspace with no logo yet is the normal state on day one, and a coloured
 * glyph reads as deliberate where two letters in a box read as a placeholder
 * somebody forgot to fill in.
 *
 * The name falls back to "Workspace" rather than to "NexusCorp": naming a
 * customer's workspace after the vendor is worse than naming it after nothing.
 */
export function OrgMark({ collapsed = false }: { collapsed?: boolean }) {
  const organization = useAppStore(s => s.organization);
  const user = useAppStore(s => s.user);

  const name = organization?.name || user?.organizationName || 'Workspace';
  const logoUrl = organization?.logoUrl ?? null;
  const branding = (organization?.policies?.branding ?? {}) as {
    primaryColour?: string;
    showLogoInSidebar?: boolean;
  };

  const showLogo = branding.showLogoInSidebar !== false;
  const accent = branding.primaryColour || '#10b981';

  return (
    <>
      <div
        className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg"
        /*
          The tint is derived from the brand colour rather than being a second
          setting, so an organisation choosing a colour gets a consistent
          surface behind their mark without configuring one.
        */
        style={{ backgroundColor: `${accent}1a` }}
      >
        {showLogo && logoUrl ? (
          /*
            `next/image` with an explicit size: the logo comes from Supabase
            storage at whatever dimensions were uploaded, and an unsized <img>
            in a flex row reflows the whole header once it loads.
          */
          <Image
            src={logoUrl}
            alt={name}
            width={32}
            height={32}
            className="size-8 object-contain"
            unoptimized
          />
        ) : (
          <Hexagon className="size-5" style={{ color: accent }} />
        )}
      </div>

      {!collapsed && (
        <span
          className={cn(
            'overflow-hidden whitespace-nowrap text-base font-semibold tracking-tight text-foreground',
            // Long company names are common and must not push the collapse
            // control off the edge of the sidebar.
            'max-w-[10rem] truncate',
          )}
          title={name}
        >
          {name}
        </span>
      )}
    </>
  );
}
