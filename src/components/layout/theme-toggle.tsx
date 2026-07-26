'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Light/dark switch for the top bar.
 *
 * `next-themes` was already installed and wrapped around the app, and the only
 * way to reach it was the command palette — a shortcut most people never open.
 * The capability existed; nothing exposed it.
 *
 * ── Why it renders a placeholder first ───────────────────────────────────
 *
 * The active theme is not knowable during server rendering: it lives in
 * localStorage and the `class` on <html>. Rendering the real icon immediately
 * makes the server emit one and the client another, so React reports a
 * hydration mismatch and — worse for the user — the icon visibly flips on
 * first paint. Waiting for mount costs one frame and avoids both.
 *
 * The placeholder keeps the button's exact footprint so the header does not
 * shift as it resolves.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" disabled aria-hidden="true">
        <Sun className="size-4 text-muted-foreground" />
      </Button>
    );
  }

  const isDark = resolvedTheme === 'dark';
  const next = isDark ? 'light' : 'dark';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(next)}
          // Announces what the control *does*, not what is currently shown —
          // a screen reader user needs the action, not the state.
          aria-label={`Switch to ${next} mode`}
        >
          {isDark
            ? <Sun className="size-4 text-muted-foreground" />
            : <Moon className="size-4 text-muted-foreground" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isDark ? 'Light mode' : 'Dark mode'}</TooltipContent>
    </Tooltip>
  );
}
