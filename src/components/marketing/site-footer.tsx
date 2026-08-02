import Link from 'next/link';
import { PLATFORM } from '@/lib/platform';
import { Logo } from '@/components/brand/logo';
import { Container } from './section';
import { FOOTER_NAV } from './nav';

/**
 * Site footer.
 *
 * ── On the social icons that used to be here ─────────────────────────────
 *
 * Four of them — Twitter, GitHub, LinkedIn, YouTube — each with `href: '#'`.
 * A row of accounts that do not exist, linking to the top of the current page.
 * They were there because footers have social icons, which is not a reason.
 *
 * A visitor who clicks one learns something specific and damaging: that the
 * things on this site are not necessarily real. That is an expensive lesson to
 * teach on the page where people go looking for your company's legitimacy.
 * They come back when there are accounts to link to.
 */
export function SiteFooter() {
  return (
    <footer className="border-hairline bg-surface mt-auto border-t">
      <Container className="py-14 sm:py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6 md:gap-8">
          <div className="col-span-2">
            <Link href="/" className="inline-flex rounded-md" aria-label="NextMav — home">
              <Logo />
            </Link>
            <p className="text-muted-foreground mt-4 max-w-[24rem] text-[0.875rem] leading-relaxed">
              {PLATFORM.tagline}
            </p>
          </div>

          {FOOTER_NAV.map((group) => (
            <nav key={group.heading} aria-labelledby={`footer-${group.heading}`}>
              <h2
                id={`footer-${group.heading}`}
                className="text-foreground text-[0.8125rem] font-semibold"
              >
                {group.heading}
              </h2>
              <ul className="mt-3.5 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-muted-foreground hover:text-foreground rounded-sm text-[0.875rem] transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-hairline text-muted-foreground mt-12 flex flex-col gap-3 border-t pt-6 text-[0.8125rem] sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {PLATFORM.name}. All rights reserved.
          </p>
          {/*
            "All systems operational" is the usual copy here, and it is a live
            claim rendered from a static string — it would keep saying so
            during an outage, which is the one moment it is read. The link goes
            to the page that actually knows.
          */}
          <Link
            href="/status"
            className="hover:text-foreground flex items-center gap-2 transition-colors"
          >
            <span aria-hidden="true" className="bg-brand size-1.5 rounded-full" />
            System status
          </Link>
        </div>
      </Container>
    </footer>
  );
}
