'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertTriangle className="size-10 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Something went wrong</h1>
          <p className="text-muted-foreground">
            An unexpected error occurred. Please try again or contact support if the problem
            persists.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button
            onClick={reset}
            className="bg-emerald-500 hover:bg-emerald-600 text-white h-11 px-6"
          >
            <RotateCcw className="size-4" />
            Try again
          </Button>
          <Button
            variant="outline"
            className="h-11 px-6"
            onClick={() => (window.location.href = '/')}
          >
            Go to Dashboard
          </Button>
        </div>

        {error.digest && (
          <p className="text-xs text-muted-foreground">Error ID: {error.digest}</p>
        )}
      </div>
    </div>
  );
}