import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/brand/logo';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  404
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── The button that lied ─────────────────────────────────────────────────
 *
 *  The primary action read "Go to Dashboard" and linked to `/`. For a signed-in
 *  visitor middleware redirects `/` to the dashboard, so it happened to be
 *  true. For everybody else — which is everybody who reaches a 404 from a
 *  search result, a stale link or a typo — it dropped them on the marketing
 *  home page having just promised a dashboard they do not have and cannot see.
 *
 *  A person who is already lost is the worst possible audience for a label
 *  that does not describe where it goes. Both destinations now say what they
 *  are, and neither claims to know who is reading.
 *
 *  ── On the 10rem "404" ───────────────────────────────────────────────────
 *
 *  It was set in `font-black` at `text-[12rem]` with a magnifying-glass icon
 *  floating in the middle of the zero. Enormous type is how an error page
 *  performs whimsy at somebody who has just failed to reach the thing they
 *  wanted. The code is worth stating, quietly, once — it is the only piece of
 *  information on the page that helps anyone diagnose anything.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col px-5 py-8 sm:px-8">
      <header>
        <Link href="/" className="inline-flex rounded-md" aria-label="NextMav — home">
          <Logo />
        </Link>
      </header>

      <main className="mx-auto my-auto w-full max-w-[34rem] py-16">
        <p className="text-muted-foreground font-mono text-[0.8125rem] tracking-[0.06em]">
          404
        </p>
        <h1 className="text-display-2 text-balance-hero mt-4">
          We can’t find that page.
        </h1>
        <p className="text-muted-foreground mt-4 text-[0.9375rem] leading-relaxed">
          It may have moved, or the link that brought you here may be out of
          date. Nothing is wrong with your account.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild variant="cta" size="xl">
            <Link href="/">
              <ArrowLeft className="size-4" />
              Back to the home page
            </Link>
          </Button>
          <Button asChild variant="ctaOutline" size="xl">
            <Link href="/help">Search the help centre</Link>
          </Button>
        </div>

        <p className="text-muted-foreground border-hairline mt-10 border-t pt-6 text-[0.875rem]">
          Looking for your workspace?{' '}
          <Link
            href="/login"
            className="text-foreground font-medium underline decoration-[1.5px] underline-offset-[3px] hover:no-underline"
          >
            Sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
