'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/brand/logo';
import { log, serializeError } from '@/lib/logger';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  /**
   * ── What this screen used to do with the error ────────────────────────────
   *
   * Nothing. It rendered an apology, printed `error.digest` in small grey text,
   * and dropped the object on the floor. The review called this out as the most
   * important finding in the report, and it was right: this is the component
   * that runs when the application has already failed, and it was the one place
   * guaranteed to know about a failure that told nobody.
   *
   * `digest` is the identifier Next assigns to the underlying server error, and
   * it is what ties this screen to the line `instrumentation.ts` wrote when the
   * error was thrown. Reporting it here is what makes the pair searchable —
   * and because it goes through the logger rather than to `console`, attaching
   * a provider later captures it without this file changing again.
   */
  useEffect(() => {
    log.error('application error boundary reached', {
      digest: error.digest,
      // Not the query string: it carries record identifiers and search terms.
      path: typeof window === 'undefined' ? undefined : window.location.pathname,
      err: serializeError(error),
    });
  }, [error]);

  /**
   * ── Why this looks calm ───────────────────────────────────────────────────
   *
   * The old screen led with a red triangle in a red circle and the words
   * "Something went wrong". A failure the reader can do nothing about is not
   * improved by alarming them about it — the destructive palette is for
   * decisions with consequences, and this screen offers no decisions.
   *
   * It also offered "Go to Dashboard", pointing at `/`, on a screen that can
   * render for a signed-out visitor. Same defect as the 404 had: a label that
   * describes a destination the reader may have no access to.
   *
   * The error ID is now presented as something to quote to support rather than
   * as grey debris at the bottom of the page — it is the only actionable thing
   * here, so it is legible, selectable and labelled.
   */
  return (
    <div className="flex min-h-screen flex-col px-5 py-8 sm:px-8">
      <header>
        <Link href="/" className="inline-flex rounded-md" aria-label="NextMav — home">
          <Logo />
        </Link>
      </header>

      <main className="mx-auto my-auto w-full max-w-[34rem] py-16">
        <p className="text-muted-foreground font-mono text-[0.8125rem] tracking-[0.06em]">
          Error
        </p>
        <h1 className="text-display-2 text-balance-hero mt-4">
          This page didn’t load.
        </h1>
        <p className="text-muted-foreground mt-4 text-[0.9375rem] leading-relaxed">
          The failure has been recorded on our side. Trying again often works —
          most of what lands here is momentary.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={reset} variant="cta" size="xl">
            <RotateCcw className="size-4" />
            Try again
          </Button>
          <Button asChild variant="ctaOutline" size="xl">
            <Link href="/">Back to the home page</Link>
          </Button>
        </div>

        {error.digest && (
          <div className="border-hairline bg-surface mt-10 rounded-lg border px-4 py-3.5">
            <p className="text-muted-foreground text-[0.8125rem]">
              Quote this if you contact us — it identifies the exact failure in
              our logs.
            </p>
            <p className="mt-1.5 font-mono text-[0.8125rem] break-all select-all">
              {error.digest}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
